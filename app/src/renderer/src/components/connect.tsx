import { useCallback, useEffect, useRef, useState } from 'react'
import type { ModelStatus, ProviderInfo } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Button, Progress, Spinner } from './ui'
import { Icon } from './icons'
import { Connections } from './Connections'
import { ConnectedMark, Disclosure, ProviderRow } from './provider-row'
import { VendorRows } from './vendor-connect'
import { SETTINGS } from './settings-index'
import './connect.css'

/** What Reel Studio makes with no editor connected. Nobody says "I" here: no editor is there to say it. */
export const WITHOUT_EDITOR = 'Without an editor, Reel Studio makes a basic version: pauses and retakes removed, subtitles and a cover.'

export { USE_CLAUDE_CODE, USE_CODEX, USING_CLAUDE_CODE, USING_CODEX, usingLine } from './vendor-connect'

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

/**
 * Choose your editor: one picker for the first run, Settings, the composer with no editor and a failed Version 1.
 * Claude and ChatGPT are rows (vendor-connect.tsx): Connect installs the person's own AI app if needed and opens that
 * vendor's own sign-in page; what they already have comes first, otherwise Claude. Choosing Claude makes main send it
 * one short message before anything says Connected. `advanced={false}` leaves out the Advanced disclosure (your own
 * server, an API key) for a page that places those itself (Settings).
 */
export function ConnectAI({ onConnected, advanced = true }: { onConnected?: (p: ProviderInfo) => void; advanced?: boolean }) {
  const [active, setActive] = useActiveEditor()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const announce = useRef(onConnected)
  announce.current = onConnected

  const connected = useCallback(
    (p: ProviderInfo) => {
      setActive(p)
      if (p.connected && p.id !== 'none') announce.current?.(p)
    },
    [setActive]
  )

  const disconnect = async () => {
    await reel.ai.setActive('none')
    setActive(await reel.ai.active())
  }

  const anyOn = !!active && active.connected && active.id !== 'none'
  const otherOn = anyOn && !['claude-cli', 'codex-cli'].includes(active.id)

  // Your own server or an API key, while it is the editor: first, so what's in use is never one click away.
  const otherRow = otherOn && (
    <ProviderRow
      key="other"
      id={active.id}
      mark={<Icon name={active.id === 'claude' ? 'key' : 'server'} size={20} />}
      name={active.id === 'claude' ? SETTINGS['api-key'].label : active.label}
      status={<ConnectedMark testid="ai-connected" />}
      tone="ok"
      action={
        <Button size="small" kind="tertiary" onClick={() => void disconnect()} data-testid="use-no-ai">
          Disconnect
        </Button>
      }
    />
  )

  return (
    <div className="picker">
      <div className="prov" role="group" aria-label="Choose your editor" data-testid="ai-picker">
        {otherRow}
        <VendorRows active={active} lead={!anyOn} onConnected={connected} onDisconnect={() => void disconnect()} />
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

const isOn = (p: ProviderInfo | null, id: ProviderInfo['id']): boolean => !!p && p.connected && p.id === id

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
          <Button size="small" onClick={() => setOpen(true)} data-testid="claude-key-toggle">
            Add key
          </Button>
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
            <Button size="small" onClick={() => void save()} disabled={!key.trim() || busy} data-testid="use-claude-key">
              {busy && <Spinner />} Use this key
            </Button>
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
          <Button kind="primary" size="big" onClick={onNext} data-testid="model-next">
            Next
          </Button>
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
              <Button size="small" kind="tertiary" onClick={() => reel.model.cancel()} data-testid="pause-model">
                Pause
              </Button>
            ) : (
              <Button size="small" onClick={() => void reel.model.download()} data-testid="download-model">
                Keep downloading
              </Button>
            )}
          </div>
        </>
      ) : (
        <Button size="big" kind={secondary ? 'secondary' : 'primary'} onClick={() => void reel.model.download()} data-testid="download-model">
          Download
        </Button>
      )}
      {s.error && (
        <div className="banner error" role="alert" data-testid="model-error">
          {s.error}
        </div>
      )}
    </div>
  )
}
