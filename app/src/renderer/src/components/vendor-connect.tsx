import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ProviderInfo, VendorId, VendorInfo } from '../../../shared/api'
import { CLAUDE_PLANS_URL, VENDOR_INSTALL_PAGES } from '../../../shared/config'
import { reel, userMessage } from '../api'
import { Button, IS_MAC, Spinner } from './ui'
import { Icon } from './icons'
import { BrandMark } from './brand'
import { ConnectedMark, ProviderRow, type Tone } from './provider-row'

/**
 * "Connect Claude" / "Connect ChatGPT" as rows of the editor picker (connect.tsx). One click installs the person's own
 * AI app if it is missing (Anthropic's Claude Code app, OpenAI's Codex app), opens that vendor's own sign-in page in the
 * browser, and makes it the AI editor once the app says it is signed in. Reel Studio never sees the sign-in: it happens
 * on the vendor's page and in the vendor's app (main/vendor-connect.ts). The steps of a connect open under its row.
 */

export const USE_CLAUDE_CODE = 'Use Claude (your Claude Code app)'
export const USE_CODEX = 'Use ChatGPT (your Codex app)'
export const USING_CLAUDE_CODE = 'Using Claude through your Claude Code app.'
export const USING_CODEX = 'Using ChatGPT through your Codex app.'

const NAME: Record<VendorId, string> = { claude: 'Claude', chatgpt: 'ChatGPT' }
const MAKER: Record<VendorId, string> = { claude: 'Anthropic', chatgpt: 'OpenAI' }
const APP: Record<VendorId, string> = { claude: "Anthropic's Claude Code app", chatgpt: "OpenAI's Codex app" }
const PROVIDER: Record<VendorId, ProviderInfo['id']> = { claude: 'claude-cli', chatgpt: 'codex-cli' }
const MARK: Record<VendorId, 'claude' | 'openai'> = { claude: 'claude', chatgpt: 'openai' }
const PLAN_LINE: Record<VendorId, string> = {
  claude: 'It uses your own Claude plan and its usage limits.',
  chatgpt: 'It uses your own ChatGPT plan and its usage limits.'
}
const PITCH: Record<VendorId, string> = {
  claude: "Needs Claude Pro or Max. Installs Anthropic's Claude Code app if you don't have it.",
  chatgpt: "Works with your ChatGPT plan, free ones too. Installs OpenAI's Codex app if you don't have it."
}
const HERE = IS_MAC ? 'this Mac' : 'this PC'

const running = (i: VendorInfo | null): boolean => !!i && ['installing', 'signing_in', 'checking'].includes(i.step)

/** The "connected" line for the person's own apps, else "Connected to <label>". */
export const usingLine = (p: ProviderInfo): string =>
  p.id === 'claude-cli' ? USING_CLAUDE_CODE : p.id === 'codex-cli' ? USING_CODEX : `Connected to ${p.label}${p.detail ? ` (${p.detail})` : ''}.`

/**
 * Both vendors' rows, in order: what the person already has first, otherwise Claude. `lead`: nothing is connected, so
 * the first row's pill is the screen's one filled button. Every row is there before the first answer, so the page
 * never jumps when one arrives.
 */
export function VendorRows({
  active,
  lead,
  onConnected,
  onDisconnect
}: {
  active: ProviderInfo | null
  lead: boolean
  onConnected: (p: ProviderInfo) => void
  onDisconnect: () => void
}) {
  const [info, setInfo] = useState<Record<VendorId, VendorInfo | null>>({ claude: null, chatgpt: null })
  // This connect went through an install, so the install line stays, ticked, while the sign-in runs.
  const [installed, setInstalled] = useState<Record<VendorId, boolean>>({ claude: false, chatgpt: false })
  // The click before main's first step: "Use Claude" checks Claude with one short message, which shows no step.
  const [asked, setAsked] = useState<VendorId | null>(null)
  const [error, setError] = useState<{ v: VendorId; text: string } | null>(null)
  const infoRef = useRef(info)
  infoRef.current = info
  const announce = useRef(onConnected)
  announce.current = onConnected

  const refresh = useCallback(async (v: VendorId) => {
    try {
      const i = await reel.ai.vendorStatus(v)
      setInfo((s) => ({ ...s, [v]: i }))
    } catch {
      /* keep the last answer */
    }
  }, [])

  useEffect(() => {
    void refresh('claude')
    void refresh('chatgpt')
    return reel.ai.onVendor((i) => {
      setInfo((s) => ({ ...s, [i.vendor]: i }))
      if (i.step === 'installing') setInstalled((s) => ({ ...s, [i.vendor]: true }))
      if (i.step === 'done') {
        setInstalled((s) => ({ ...s, [i.vendor]: false }))
        void reel.ai.active().then((p) => announce.current(p), () => undefined)
      }
    })
  }, [refresh])

  // Back to the window (after "Install it myself", or signing in some other way): look again, unless a connect runs.
  useEffect(() => {
    const onFocus = (): void => {
      for (const v of ['claude', 'chatgpt'] as VendorId[]) if (!running(infoRef.current[v])) void refresh(v)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const connect = (v: VendorId): void => {
    setError(null)
    setAsked(v)
    setInstalled((s) => ({ ...s, [v]: false }))
    reel.ai
      .vendorConnect(v)
      .then((i) => setInfo((s) => ({ ...s, [v]: i })))
      .catch((e) => setError({ v, text: userMessage(e) }))
      .finally(() => setAsked((a) => (a === v ? null : a)))
  }

  const order: VendorId[] = info.chatgpt?.state === 'ready' && info.claude?.state !== 'ready' ? ['chatgpt', 'claude'] : ['claude', 'chatgpt']
  return (
    <>
      {order.map((v, k) => (
        <VendorRow
          key={v}
          vendor={v}
          info={info[v]}
          on={!!active?.connected && active.id === PROVIDER[v]}
          primary={lead && k === 0}
          installed={installed[v]}
          asked={asked === v}
          error={error?.v === v ? error.text : null}
          onConnect={() => connect(v)}
          onOther={() => connect(order[1 - k])}
          onDisconnect={onDisconnect}
        />
      ))}
    </>
  )
}

function VendorRow({
  vendor: v,
  info,
  on,
  primary,
  installed,
  asked,
  error,
  onConnect,
  onOther,
  onDisconnect
}: {
  vendor: VendorId
  info: VendorInfo | null
  on: boolean
  primary: boolean
  installed: boolean
  asked: boolean
  error: string | null
  onConnect: () => void
  onOther: () => void
  onDisconnect: () => void
}) {
  const [fallbackError, setFallbackError] = useState<string | null>(null)
  const row = useRef<HTMLDivElement>(null)
  const step = info?.step ?? 'loading'
  const attrs = { 'data-testid': `vendor-${v}`, 'data-step': step, 'data-state': info?.state ?? 'loading', ...(info?.problem ? { 'data-problem': info.problem } : {}) }

  // The pill pressed gives way to Cancel, and Cancel to the row's next pill: focus follows to the button in the same
  // place, never to the page.
  useEffect(() => {
    if (document.activeElement === document.body) row.current?.querySelector<HTMLElement>('.pv-main > button')?.focus({ preventScroll: true })
  }, [step, asked, on])

  const cancel = (): void => {
    void reel.ai.vendorCancel(v)
  }
  const windowFallback = (): void => {
    setFallbackError(null)
    reel.ai.openClaudeSignIn().catch((e) => setFallbackError(userMessage(e)))
  }

  let status: ReactNode
  let tone: Tone = 'plain'
  let action: ReactNode = null
  let more: ReactNode = null

  if (!info) {
    status = (
      <>
        <Spinner /> Looking on {HERE}…
      </>
    )
  } else if (on) {
    status = <ConnectedMark testid="ai-connected" />
    tone = 'ok'
    action = (
      <Button size="small" kind="tertiary" onClick={onDisconnect} data-testid="use-no-ai">
        Disconnect
      </Button>
    )
  } else if (running(info)) {
    const installing = step === 'installing'
    const signing = step === 'signing_in'
    tone = 'busy'
    status = (
      <>
        <Spinner /> {installing ? `Installing ${APP[v]}…` : signing ? 'Finish signing in in your browser' : 'Checking that it worked…'}
      </>
    )
    action = (
      <Button size="small" kind="tertiary" onClick={cancel} data-testid={`vendor-cancel-${v}`}>
        Cancel
      </Button>
    )
    more = (
      <div className="pv-more vendor-steps">
        <ol className="vsteps">
          {(installing || installed) && (
            <Step state={installing ? 'now' : 'done'}>
              {installing ? (
                <>
                  <b>Installing {APP[v]}</b>
                  <span>Takes a minute or two.</span>
                </>
              ) : (
                <b>{APP[v]} installed</b>
              )}
            </Step>
          )}
          <Step state={installing ? 'later' : 'now'}>
            {signing ? (
              <>
                <b>Finish signing in in your browser.</b>
                <span>
                  It's {MAKER[v]}'s page. Come back here when it says you're signed in.
                </span>
              </>
            ) : step === 'checking' ? (
              <b>Checking that it worked…</b>
            ) : (
              <b>Sign in to {NAME[v]} in your browser</b>
            )}
          </Step>
        </ol>
        {signing && (
          <div className="row wrap vsteps-acts">
            <Button size="small" onClick={() => void reel.ai.vendorSignInAgain(v)} data-testid={`vendor-again-${v}`}>
              Open the sign-in page again
            </Button>
            {v === 'claude' && (
              <button className="link inline" onClick={windowFallback} data-testid="claude-window-fallback">
                The page shows a code? Sign in in a window instead
              </button>
            )}
          </div>
        )}
        {signing && v === 'claude' && (
          <p className="vsteps-hint" data-testid="claude-free-hint">
            Does {MAKER[v]}'s page say you need Claude Pro or Max? The free Claude plan can't be used here.{' '}
            <a href={CLAUDE_PLANS_URL} target="_blank" rel="noreferrer">
              See Claude plans
            </a>{' '}
            or{' '}
            <button className="link inline" onClick={onOther} data-testid="claude-free-switch">
              connect ChatGPT
            </button>
            , whose free plan works.
          </p>
        )}
        {fallbackError && <p className="pv-note error">{fallbackError}</p>}
      </div>
    )
  } else if (asked) {
    // main has not sent a step yet: on beta that is Claude's short check before it becomes the editor
    tone = 'busy'
    status = (
      <>
        <Spinner /> {v === 'claude' ? 'Checking Claude…' : `Connecting ${NAME[v]}…`}
      </>
    )
    action = (
      <Button size="small" kind="tertiary" onClick={cancel} data-testid={v === 'claude' ? 'claude-check-cancel' : `vendor-cancel-${v}`}>
        Cancel
      </Button>
    )
  } else if (step === 'failed' || error) {
    const free = info.problem === 'free_plan'
    const installProblem = info.problem === 'install_failed' || info.problem === 'not_found_after_install'
    tone = free ? 'plain' : 'error'
    status = <span data-testid={`vendor-message-${v}`}>{error ?? info.message}</span>
    action = (
      <Button size="small" onClick={onConnect} data-testid={`vendor-retry-${v}`}>
        {free ? 'Check again' : 'Try again'}
      </Button>
    )
    if (installProblem || free)
      more = (
        <div className="pv-more vendor-steps">
          <div className="row wrap vsteps-acts">
            {installProblem && (
              <a className="btn small" href={VENDOR_INSTALL_PAGES[v]} target="_blank" rel="noreferrer" data-testid={`vendor-install-page-${v}`}>
                <Icon name="external" size={14} /> Install it myself
              </a>
            )}
            {free && (
              <a className="btn small" href={CLAUDE_PLANS_URL} target="_blank" rel="noreferrer">
                <Icon name="external" size={14} /> See Claude plans
              </a>
            )}
          </div>
          {installProblem && (
            <p className="vsteps-hint">“Install it myself” opens {MAKER[v]}'s install page. Come back here and it checks again by itself.</p>
          )}
          {free && <p className="vsteps-hint">Or connect ChatGPT. Its free plan works, with limits.</p>}
        </div>
      )
  } else {
    const ready = info.state === 'ready'
    status = ready ? PLAN_LINE[v] : PITCH[v]
    action = (
      <Button
        size="small"
        kind={primary ? 'primary' : 'secondary'}
        onClick={onConnect}
        aria-label={ready ? (v === 'claude' ? USE_CLAUDE_CODE : USE_CODEX) : `Connect ${NAME[v]}`}
        data-testid={ready ? (v === 'claude' ? 'use-claude-code' : 'use-codex') : `connect-${v}`}
      >
        {ready ? `Use ${NAME[v]}` : 'Connect'}
      </Button>
    )
    if (info.message)
      more = (
        <p className="pv-more vsteps-hint" data-testid={`vendor-note-${v}`}>
          {info.message}
        </p>
      )
  }

  return (
    <div ref={row} {...attrs}>
      <ProviderRow id={PROVIDER[v]} mark={<BrandMark name={MARK[v]} size={20} />} name={NAME[v]} status={status} tone={tone} action={action}>
        {more}
      </ProviderRow>
    </div>
  )
}

/** One line of a connect: running now, done (a tick) or still to come. */
function Step({ state, children }: { state: 'now' | 'done' | 'later'; children: ReactNode }) {
  return (
    <li className={`vstep ${state}`}>
      <span className="vstep-mark" aria-hidden>
        {state === 'now' ? <Spinner /> : state === 'done' ? <Icon name="check" size={13} stroke={2.4} /> : <span className="vstep-dot" />}
      </span>
      <span className="vstep-what">{children}</span>
    </li>
  )
}
