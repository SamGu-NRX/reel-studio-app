import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClaudeCodeInfo, ModelStatus, ProviderInfo } from '../../../shared/api'
import { errorCode, reel, userMessage } from '../api'
import { IS_MAC, Progress, Spinner } from './ui'
import { Icon } from './icons'
import { Connections } from './Connections'
import { BrandMark } from './brand'
import { ConnectedMark, Disclosure, ProviderRow, type Tone } from './provider-row'
import { SETTINGS } from './settings-index'
import './connect.css'

/** What Reel Studio makes with no editor connected. Nobody says "I" here: no editor is there to say it. */
export const WITHOUT_EDITOR = 'Without an editor, Reel Studio makes a basic version: pauses and retakes removed, subtitles and a cover.'

/** Anthropic's own install page for the Claude Code app. */
export const CLAUDE_CODE_SETUP_URL = 'https://code.claude.com/docs/en/setup'
export const USE_CLAUDE_CODE = 'Use Claude (your Claude Code app)'
export const USING_CLAUDE_CODE = 'Using Claude through your Claude Code app.'
const HERE = IS_MAC ? 'this Mac' : 'this PC'
/** While a sign-in window is open: check every 3 s, for up to 10 minutes. */
const WAIT_EVERY_MS = 3000
const WAIT_FOR_MS = 10 * 60_000

/** The editor in use, kept current: every call that changes it announces the change (main/index.ts changesAI). */
export function useActiveEditor(): [ProviderInfo | null, (p: ProviderInfo) => void] {
  const [active, setActive] = useState<ProviderInfo | null>(null)
  useEffect(() => {
    let live = true
    reel.ai
      .active()
      .then((p) => live && setActive(p))
      .catch(() => {})
    const off = reel.ai.onChange(setActive)
    return () => {
      live = false
      off()
    }
  }, [])
  return [active, setActive]
}

const isOn = (p: ProviderInfo | null, id: ProviderInfo['id']): boolean => !!p && p.connected && p.id === id

/** The check call to Claude failed: what happened, and what to do, in plain words. */
function claudeCheckFailed(e: unknown): string {
  switch (errorCode(e)) {
    case 'cli_limited':
      return 'Your Claude plan is at its limit. Try again after it resets.'
    case 'cli_timeout':
      return "Claude took too long to answer. Check you're online, then try again."
    case 'cli_error':
      return "Claude didn't answer. Open your Claude Code app once to check it works, then try again."
    case 'cli_missing':
      return `The Claude Code app isn't on ${HERE} any more.`
    default:
      return userMessage(e)
  }
}

/**
 * Choose your editor: one picker for the first run, Settings, the composer with no editor and a failed Version 1.
 * A signed-in Claude Code leads with the one filled button; otherwise ChatGPT's sign-in does. "Use Claude" makes
 * main send Claude one short message before anything says Connected. `advanced={false}` leaves out the Advanced
 * disclosure (your own server, an API key) for a page that places those itself (Settings).
 *
 * Reel Studio never sees the Claude sign-in: it happens in Anthropic's own app, in a terminal window, and the app
 * only asks that app "signed in or not?".
 */
export function ConnectAI({ onConnected, advanced = true }: { onConnected?: (p: ProviderInfo) => void; advanced?: boolean }) {
  const [active, setActive] = useActiveEditor()
  const [claude, setClaude] = useState<ClaudeCodeInfo | null>(null)
  const [busy, setBusy] = useState<'claude' | 'chatgpt' | null>(null)
  const [claudeError, setClaudeError] = useState<string | null>(null)
  const [chatgptError, setChatgptError] = useState<string | null>(null)
  // a sign-in window is open
  const [waiting, setWaiting] = useState(false)
  const [install, setInstall] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const waitingRef = useRef(false)
  waitingRef.current = waiting
  const checking = useRef(false)
  const announce = useRef(onConnected)
  announce.current = onConnected

  const connected = useCallback(
    (p: ProviderInfo) => {
      setActive(p)
      if (p.connected && p.id !== 'none') announce.current?.(p)
    },
    [setActive]
  )

  const useClaude = useCallback(async () => {
    setBusy('claude')
    setClaudeError(null)
    try {
      await reel.ai.setActive('claude-cli')
      connected(await reel.ai.active())
    } catch (e) {
      setClaudeError(claudeCheckFailed(e))
    } finally {
      setBusy(null)
    }
  }, [connected])

  const checkClaude = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    try {
      const s = await reel.ai.claudeCodeStatus()
      setClaude(s)
      // They started the sign-in here, so once it worked, that is their choice: use it.
      if (s.state === 'ready' && waitingRef.current) {
        setWaiting(false)
        await useClaude()
      }
    } catch {
      setClaude((c) => c ?? { state: 'missing' })
    } finally {
      checking.current = false
    }
  }, [useClaude])

  useEffect(() => {
    void checkClaude()
  }, [checkClaude])

  // Coming back to the window (after signing in or installing) checks again.
  useEffect(() => {
    const onFocus = () => void checkClaude()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkClaude])

  useEffect(() => {
    if (!waiting) return
    const started = Date.now()
    const t = setInterval(() => {
      if (Date.now() - started > WAIT_FOR_MS) setWaiting(false)
      else void checkClaude()
    }, WAIT_EVERY_MS)
    return () => clearInterval(t)
  }, [waiting, checkClaude])

  const chatgpt = async () => {
    setBusy('chatgpt')
    setChatgptError(null)
    try {
      const p = await reel.ai.signInChatGPT()
      if (p.connected) connected(p)
      else if (p.error) setChatgptError(p.error.userMessage)
    } catch (e) {
      setChatgptError(userMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const signInClaude = async () => {
    setClaudeError(null)
    try {
      await reel.ai.openClaudeSignIn()
      setWaiting(true)
    } catch (e) {
      setClaudeError(userMessage(e))
    }
  }

  const disconnect = async () => {
    if (active?.id === 'chatgpt') await reel.ai.signOutChatGPT()
    else await reel.ai.setActive('none')
    setActive(await reel.ai.active())
  }

  if (!claude)
    return (
      <p className="pv-looking" role="status">
        <Spinner /> Looking for Claude on {HERE}…
      </p>
    )

  const st = claude.state
  const claudeOn = isOn(active, 'claude-cli')
  const chatgptOn = isOn(active, 'chatgpt')
  const otherOn = !!active && active.connected && !['none', 'claude-cli', 'chatgpt'].includes(active.id)
  const anyOn = claudeOn || chatgptOn || otherOn
  const claudeLeads = !chatgptOn && (claudeOn || st === 'ready')
  // the leading row's pill is the screen's one filled button, until an editor is connected
  const primary = (leads: boolean): string => (!anyOn && leads ? ' primary' : '')
  const off = (
    <button className="btn small ghost" onClick={() => void disconnect()} data-testid="use-no-ai">
      {active?.id === 'chatgpt' ? 'Sign out' : 'Disconnect'}
    </button>
  )
  const checkAgain = (
    <button className="btn small" onClick={() => void checkClaude()} data-testid="claude-code-check">
      Check again
    </button>
  )

  let claudeStatus: ReactNode
  let claudeTone: Tone = 'plain'
  let claudeAction: ReactNode = null
  if (claudeOn) {
    claudeStatus = <ConnectedMark testid="ai-connected" />
    claudeTone = 'ok'
    claudeAction = off
  } else if (busy === 'claude') {
    claudeStatus = (
      <>
        <Spinner /> Checking Claude…
      </>
    )
    claudeTone = 'busy'
  } else if (claudeError) {
    claudeStatus = claudeError
    claudeTone = 'error'
    claudeAction = (
      <button className="btn small" onClick={() => void (st === 'ready' ? useClaude() : signInClaude())} disabled={!!busy} data-testid="claude-try-again">
        Try again
      </button>
    )
  } else if (st === 'ready') {
    claudeStatus = `Found on ${HERE}`
    claudeAction = (
      <button className={`btn small${primary(claudeLeads)}`} onClick={() => void useClaude()} disabled={!!busy} aria-label={USE_CLAUDE_CODE} data-testid="use-claude-code">
        Use Claude
      </button>
    )
  } else if (st === 'signed_out' && waiting) {
    claudeStatus = (
      <span data-testid="claude-code-waiting">
        <Spinner /> Sign in in the window that opened
      </span>
    )
    claudeTone = 'busy'
    claudeAction = checkAgain
  } else if (st === 'signed_out') {
    claudeStatus = 'Sign in with your plan'
    claudeAction = (
      <button className="btn small" onClick={() => void signInClaude()} disabled={!!busy} aria-label="Sign in to your Claude Code app" data-testid="claude-code-signin">
        Sign in
      </button>
    )
  } else {
    claudeStatus = st === 'broken' ? "Your Claude Code app didn't start" : 'Not set up'
    claudeAction = install ? null : (
      <button className="btn small" onClick={() => setInstall(true)} data-testid="claude-code-toggle">
        Set up
      </button>
    )
  }

  const claudeRow = (
    <ProviderRow key="claude" id="claude-cli" mark={<BrandMark name="claude" size={20} />} name="Claude" status={claudeStatus} tone={claudeTone} action={claudeAction}>
      {install && !claudeOn && (st === 'missing' || st === 'broken') && (
        <div className="pv-more" data-testid="claude-code-choice" data-state={st}>
          <ol className="pv-steps" data-testid="claude-code-install">
            <li>
              Open{' '}
              <a href={CLAUDE_CODE_SETUP_URL} target="_blank" rel="noreferrer">
                Anthropic's install page
              </a>
              .
            </li>
            <li>Follow the steps for your {IS_MAC ? 'Mac' : 'PC'}. The Claude Code app needs a paid Claude plan (Pro or Max).</li>
            <li>Come back here and click Check again.</li>
          </ol>
          <div>{checkAgain}</div>
        </div>
      )}
    </ProviderRow>
  )

  const chatgptRow = (
    <ProviderRow
      key="chatgpt"
      id="chatgpt"
      mark={<BrandMark name="openai" size={20} />}
      name="ChatGPT"
      tone={chatgptOn ? 'ok' : busy === 'chatgpt' ? 'busy' : chatgptError ? 'error' : 'plain'}
      status={
        chatgptOn ? (
          <ConnectedMark testid="ai-connected" />
        ) : busy === 'chatgpt' ? (
          <>
            <Spinner /> Waiting for your browser…
          </>
        ) : (
          (chatgptError ?? 'Sign in with your plan')
        )
      }
      action={
        chatgptOn ? (
          off
        ) : busy === 'chatgpt' ? (
          <button className="btn small ghost" onClick={() => void reel.ai.cancelSignIn()}>
            Cancel
          </button>
        ) : (
          <button className={`btn small${primary(!claudeLeads)}`} onClick={() => void chatgpt()} disabled={!!busy} data-testid="signin-chatgpt">
            Sign in
          </button>
        )
      }
    />
  )

  // Your own server or an API key, while it is the editor: first, so what's in use is never one click away.
  const otherRow = otherOn && (
    <ProviderRow
      key="other"
      id={active.id}
      mark={<Icon name={active.id === 'claude' ? 'key' : 'server'} size={20} />}
      name={active.id === 'claude' ? SETTINGS['api-key'].label : active.label}
      status={<ConnectedMark testid="ai-connected" />}
      tone="ok"
      action={off}
    />
  )

  return (
    <div className="picker">
      <div className="prov" role="group" aria-label="Choose your editor" data-testid="ai-picker">
        {otherRow}
        {claudeLeads ? [claudeRow, chatgptRow] : [chatgptRow, claudeRow]}
      </div>
      {active?.error && !active.connected && (
        <p className="pv-note error" role="alert">
          {active.error.userMessage}
        </p>
      )}
      {advanced && (
        <Disclosure label="Advanced" open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)} testid="ai-advanced">
          <Connections onConnected={connected} />
          <AnthropicKey active={active} onConnected={connected} />
        </Disclosure>
      )}
      {!anyOn && (
        <p className="noai-line" data-testid="without-ai">
          {WITHOUT_EDITOR}
        </p>
      )}
    </div>
  )
}

/** An Anthropic API key: billed by Anthropic as it's used, separately from a Claude plan. */
export function AnthropicKey({ active, onConnected }: { active: ProviderInfo | null; onConnected: (p: ProviderInfo) => void }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const on = isOn(active, 'claude')

  const save = async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const p = await reel.ai.setClaudeKey(key.trim())
      if (p.connected) {
        setKey('')
        setOpen(false)
        onConnected(p)
      } else if (p.error) setError(p.error.userMessage)
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ProviderRow
      id="claude"
      setting="api-key"
      mark={<Icon name="key" size={20} />}
      tone={on ? 'ok' : error ? 'error' : 'plain'}
      status={on ? <ConnectedMark /> : (error ?? 'Billed by Anthropic as you use it')}
      action={
        on || open ? null : (
          <button className="btn small" onClick={() => setOpen(true)} data-testid="claude-key-toggle">
            Add key
          </button>
        )
      }
    >
      {open && !on && (
        <div className="pv-more">
          <div className="row">
            <input
              className="input"
              type="password"
              autoFocus
              placeholder="Paste your Anthropic API key"
              aria-label={SETTINGS['api-key'].label}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
                if (e.key === 'Escape') setOpen(false)
              }}
              data-testid="claude-key-input"
            />
            <button className="btn small" onClick={() => void save()} disabled={!key.trim() || busy} data-testid="use-claude-key">
              {busy && <Spinner />} Use this key
            </button>
          </div>
          <p className="muted-sm">
            No key?{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              Get one from Anthropic
            </a>
            .
          </p>
        </div>
      )}
    </ProviderRow>
  )
}

/** Every provider as a chip, for developers (REELSTUDIO_DEV=1 adds codex-cli and replay). Never shown to users. */
export function DevProviders() {
  const [list, setList] = useState<ProviderInfo[]>([])
  const [active, setActive] = useState<string>('')
  const load = () => {
    reel.ai.providers().then(setList)
    reel.ai.active().then((a) => setActive(a.id))
  }
  useEffect(load, [])
  return (
    <div className="row wrap">
      {list.map((p) => (
        <button
          key={p.id}
          className={`chip${p.id === active ? ' active' : ''}`}
          onClick={async () => {
            await reel.ai.setActive(p.id)
            load()
          }}
          data-testid={`provider-${p.id}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

export const MODEL_FOUND = 'Found the listening model on this computer. Using it, no download needed.'

const mb = (bytes: number): number => Math.round(bytes / 1e6)

export function downloadLine(s: ModelStatus, verb: 'Downloading' | 'Paused at'): string {
  return s.total > 0 ? `${verb} ${mb(s.bytes)} of ${mb(s.total)} MB` : `${verb} ${s.pct}%`
}

/**
 * The listening model's state, after looking for a matching copy already on this computer. `onDownloaded` fires only
 * the moment a download finishes, not for a model that was already here or a copy found here.
 */
export function useModelStatus(onDownloaded?: () => void) {
  const [s, setS] = useState<ModelStatus | null>(null)
  const [looked, setLooked] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tries, setTries] = useState(0)
  const wasInstalled = useRef<boolean | null>(null)
  const downloaded = useRef(onDownloaded)
  downloaded.current = onDownloaded
  useEffect(() => {
    let alive = true
    const show = (m: ModelStatus) => {
      if (!alive) return
      setS(m)
      if (wasInstalled.current === false && m.installed && !m.reused) downloaded.current?.()
      wasInstalled.current = m.installed
    }
    const off = reel.model.onProgress(show)
    void (async () => {
      try {
        const m = await reel.model.status()
        show(m)
        if (!m.installed && !m.downloading) show(await reel.model.find())
      } catch {
        if (alive) setFailed(true)
      } finally {
        if (alive) setLooked(true)
      }
    })()
    return () => {
      alive = false
      off()
    }
  }, [tries])
  const retry = (): void => {
    setFailed(false)
    setLooked(false)
    setTries((n) => n + 1)
  }
  return { s, looked, failed, retry }
}

/** The one-time listening model download, for Settings and the "model missing" screen. */
/** `secondary` on Settings, where the AI editor is the main action (custom-server). */
export function ModelDownload({ secondary }: { secondary?: boolean } = {}) {
  const { s } = useModelStatus()
  return s ? <ModelPanel s={s} secondary={secondary} /> : <Spinner />
}

/** With `onNext`, a model that is here shows Next. */
export function ModelPanel({ s, onNext, secondary }: { s: ModelStatus; onNext?: () => void; secondary?: boolean }) {
  if (s.installed)
    return (
      <div className="stack">
        <div className="banner good">The listening model is ready.</div>
        {s.checkFailed && (
          <p className="muted-sm" data-testid="model-check-failed">
            Reel Studio couldn't work out the fastest settings for this computer, so the listening model uses its usual
            ones. Everything still works.
          </p>
        )}
        {onNext && (
          <button className="btn primary big" onClick={onNext} data-testid="model-next">
            Next
          </button>
        )}
      </div>
    )
  if (s.checking)
    return (
      <div className="stack" data-testid="model-checking">
        <Progress pct={s.pct} label="Checking the listening model" />
        <span className="muted">Checking the listening model on this computer</span>
      </div>
    )
  const paused = !s.downloading && s.pct > 0 && s.pct < 100
  return (
    <div className="stack">
      {s.downloading || paused ? (
        <>
          <Progress pct={s.pct} label="Downloading the listening model" />
          <div className="row">
            <span className="muted" data-testid="model-progress">
              {downloadLine(s, s.downloading ? 'Downloading' : 'Paused at')}
            </span>
            <span className="spacer" />
            {s.downloading ? (
              <button className="btn small ghost" onClick={() => reel.model.cancel()} data-testid="pause-model">
                Pause
              </button>
            ) : (
              <button className="btn small" onClick={() => void reel.model.download()} data-testid="download-model">
                Keep downloading
              </button>
            )}
          </div>
        </>
      ) : (
        <button className={`btn big${secondary ? '' : ' primary'}`} onClick={() => void reel.model.download()} data-testid="download-model">
          Download
        </button>
      )}
      {s.error && (
        <div className="banner error" role="alert" data-testid="model-error">
          {s.error}
        </div>
      )}
    </div>
  )
}
