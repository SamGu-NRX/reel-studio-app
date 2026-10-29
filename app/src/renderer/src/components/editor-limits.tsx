// The editor in use, shown truthfully: which accounts it runs as, their plans and what each has left with its reset
// time, a Test that says which model answered and how fast, and a model for each stage of the work (T3 Code's model
// picker: a chip per stage opening a searchable list grouped by provider, built from the editor's own model list).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { EditorAccounts, EditorModel, LimitWindow, ModelChoice, ModelFamily, ModelRole, ProviderInfo, TestResult } from '../../../shared/api'
import { MODEL_ROLES } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Button, Spinner } from './ui'
import { Icon } from './icons'
import { BrandMark } from './brand'
import { planName } from './vendor-connect'

// ---- time words -----------------------------------------------------------------------------------------------

/** "in 42 min" within the hour, "6:20 PM" today, "Sat 9 AM" later: short enough for one line of a 310 px column. */
export function resetShort(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const at = new Date(iso)
  const ms = at.getTime() - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 60_000) return 'now'
  if (ms < 3_600_000) return `in ${Math.round(ms / 60_000)} min`
  const sameDay = new Date(now).toDateString() === at.toDateString()
  const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined })
  return sameDay ? clock : `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`
}

/** "6:20 PM" today, "Sat 9 AM" later: the clock, for "until …", where "until in 42 min" would not read. */
export function untilShort(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const at = new Date(iso)
  if (!Number.isFinite(at.getTime())) return ''
  const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: at.getMinutes() ? '2-digit' : undefined })
  return new Date(now).toDateString() === at.toDateString() ? clock : `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${clock}`
}

/** "resets today at 6:20 PM (in 2 h 14 min)": the full words, for tooltips and screen readers. */
export function resetLong(iso: string | undefined, now = Date.now()): string {
  if (!iso) return 'no reset time given'
  const at = new Date(iso)
  const ms = at.getTime() - now
  if (!Number.isFinite(ms)) return 'no reset time given'
  if (ms <= 60_000) return 'resets now'
  const mins = Math.round(ms / 60_000)
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? '' : 's'}`
  const span = mins < 60 ? n(mins, 'minute') : mins < 1440 ? `${n(Math.floor(mins / 60), 'hour')}${mins % 60 ? ` ${n(mins % 60, 'minute')}` : ''}` : `${n(Math.floor(mins / 1440), 'day')} ${n(Math.floor((mins % 1440) / 60), 'hour')}`
  const day = new Date(now).toDateString() === at.toDateString() ? 'today' : at.toLocaleDateString('en-US', { weekday: 'long' })
  return `resets ${day} at ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} (in ${span})`
}

/** A name for a model the editor's list doesn't (or no longer) name: the id spoken the way ai limits.ts nameFromId
 *  says it, so UI copy never shows a raw id such as claude-sonnet-5-5. */
export function idName(id: string): string {
  const bare = id.replace(/\([a-z]+\)$/, '').slice(id.lastIndexOf('/') + 1).replace(/-\d{8}$/, '')
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(bare)
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`
  return bare
    .split('-')
    .map((w) => (/^gpt$/i.test(w) ? 'GPT' : w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/^GPT (\d)/, 'GPT-$1')
}

// ---- accounts and limits ----------------------------------------------------------------------------------------

const PROVIDER_NAME: Record<string, string> = { claude: 'Claude', codex: 'ChatGPT', anthropic: 'Claude', openai: 'ChatGPT' }
const MANY = 4

function Window({ w }: { w: LimitWindow }) {
  const level = w.left === 0 ? 'out' : w.left <= 20 ? 'low' : 'ok'
  const said = `${w.label}: ${w.left}% left, ${resetLong(w.resetsAt)}`
  return (
    <li className={`ed-lw ${level}`} aria-label={said} title={said}>
      <span className="ed-lw-label">{w.label}</span>
      <span className="ed-lw-bar" aria-hidden>
        <i style={{ transform: `scaleX(${w.left / 100})` }} />
      </span>
      <span className="ed-lw-text">
        <b>{w.left}% left</b>
        {w.resetsAt ? ` · resets ${resetShort(w.resetsAt)}` : ''}
      </span>
    </li>
  )
}

function Account({ a }: { a: EditorAccounts['accounts'][number] }) {
  const plan = planName(a.plan)
  return (
    <li className="ed-acct" data-testid="editor-account">
      <div className="ed-acct-h">
        <bdi className="ed-acct-name" title={a.name}>
          {a.name}
        </bdi>
        <span className="ed-acct-plan" title={[PROVIDER_NAME[a.provider] ?? a.provider, plan].filter(Boolean).join(' · ')}>
          {[PROVIDER_NAME[a.provider] ?? a.provider, plan].filter(Boolean).join(' · ')}
        </span>
      </div>
      {a.windows.length > 0 && (
        <ul className="ed-lws" aria-label={`${a.name}: limits`}>
          {a.windows.map((w) => (
            <Window key={w.label} w={w} />
          ))}
        </ul>
      )}
      {a.problem && <p className="ed-acct-note">{a.problem}</p>}
      {!a.problem && !a.windows.length && <p className="ed-acct-note">No limits reported yet. A Test shows them.</p>}
      {a.restingUntil && <p className="ed-acct-note warn">CLIProxyAPI is resting this account until {untilShort(a.restingUntil)}.</p>}
    </li>
  )
}

/** The accounts behind the editor in use. CLIProxyAPI asks for its management key first, as T3 Code's Add hub does. */
function Accounts({ data, onChange }: { data: EditorAccounts | null; onChange: (d: EditorAccounts) => void }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  if (!data) return <p className="ed-note"><Spinner /> Reading accounts…</p>
  const add = async () => {
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      onChange(await reel.ai.setHubManagementKey(key.trim()))
      setKey('')
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setBusy(false)
    }
  }
  if (data.needsManagementKey)
    return (
      <form
        className="ed-mgmt"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
        data-testid="hub-management"
      >
        <p className="ed-note">{data.problem ?? 'Add CLIProxyAPI’s management key to see each account, its plan and what’s left.'}</p>
        <div className="hub-key-row">
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Management key"
            aria-label="CLIProxyAPI management key"
            aria-invalid={!!error}
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setError(null)
            }}
            data-testid="hub-management-key"
          />
          <Button type="submit" size="small" disabled={!key.trim() || busy} data-testid="hub-management-add">
            {busy ? <Spinner /> : null}
            Add
          </Button>
        </div>
        <p className={`vsteps-hint${error ? ' error' : ''}`} role={error ? 'alert' : undefined}>
          {error ?? 'The secret-key under remote-management in its config. Kept encrypted here.'}
        </p>
      </form>
    )
  if (data.problem && !data.accounts.length) return <p className="ed-note warn" role="status">{data.problem}</p>
  if (!data.accounts.length) return null
  const shown = all ? data.accounts : data.accounts.slice(0, MANY)
  return (
    <>
      <ul className="ed-accts" data-testid="editor-accounts">
        {shown.map((a, i) => (
          <Account key={`${a.provider}-${a.name}-${i}`} a={a} />
        ))}
      </ul>
      {data.accounts.length > MANY && (
        <button className="link inline ed-more" aria-expanded={all} onClick={() => setAll((x) => !x)}>
          {all ? 'Show fewer' : `Show all ${data.accounts.length} accounts`}
        </button>
      )}
    </>
  )
}

/**
 * A model a limited stage could try: the first of another family in the editor's list now, which runs on other
 * accounts. Not offered when the accounts shown for that family all have a window at nothing left.
 */
export function otherModel(models: EditorModel[], limitedModel: string | undefined, accounts: EditorAccounts['accounts'] = []): EditorModel | undefined {
  const bare = (limitedModel ?? '').replace(/\([a-z]+\)$/, '')
  const fam = models.find((m) => m.id === bare)?.family ?? (bare.startsWith('claude') || bare === 'sonnet' || bare === 'opus' || bare === 'fable' ? 'claude' : 'gpt')
  const spent = (f: string): boolean => {
    const mine = accounts.filter((a) => (f === 'claude' ? a.provider === 'claude' : a.provider === 'codex') && a.windows.length)
    return mine.length > 0 && mine.every((a) => a.windows.some((w) => w.left === 0))
  }
  return models.find((m) => m.family !== fam && (m.family === 'claude' || m.family === 'gpt') && !spent(m.family))
}

/**
 * Under the row of the editor in use: its accounts, plans and limits, and Test. Test sends one tiny prompt with the
 * Edits model and says what answered, which model and how long it took; a limit says whose and when it resets, and
 * offers the other family's model for Edits.
 */
export function EditorDetails({ active, stages }: { active: ProviderInfo; stages: StageState }) {
  const { accounts, setAccounts, reloadAccounts: load } = stages
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: TestResult } | { error: string; code?: string } | null>(null)
  useEffect(() => setResult(null), [active.id, active.connectionId])

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      setResult({ ok: await reel.ai.test('editor') })
    } catch (e) {
      setResult({ error: userMessage(e), code: (e as { code?: string })?.code })
    } finally {
      setTesting(false)
      load()
    }
  }
  const limited = result && 'error' in result && /limit/.test(result.code ?? '')
  const edits = stages.choice?.editor
  // on Auto, Edits runs on the connection's own model, which the editor's status names
  const alt = limited ? otherModel(stages.models, edits && edits !== 'auto' ? edits : active.detail, accounts?.accounts) : undefined
  const modelName = (id?: string) => (id ? (stages.models.find((m) => m.id === id.replace(/\([a-z]+\)$/, ''))?.name ?? idName(id)) : '')
  const took = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
  // the button below makes the offer, so the words don't repeat it
  const said = result && 'error' in result && alt ? result.error.replace(/ (Your (Claude|ChatGPT) accounts have room: you|If your (Claude|ChatGPT) accounts have room, you) could try .+\. Choose it in Settings, under Editor\.$/, '') : null

  return (
    <div className="pv-more ed" data-testid="editor-details">
      <Accounts data={accounts} onChange={setAccounts} />
      <div className="ed-test">
        <Button size="small" onClick={() => void test()} disabled={testing} data-testid="editor-test">
          {testing ? <Spinner /> : null}
          {testing ? 'Testing…' : 'Test'}
        </Button>
        <p className={`ed-result${result && 'error' in result ? ' error' : ''}`} role="status" data-testid="editor-test-result">
          {!result
            ? 'Sends one short message with the Edits model.'
            : 'ok' in result
              ? `“${result.ok.reply.slice(0, 40)}” from ${modelName(result.ok.model) || 'your editor'} in ${took(result.ok.ms)}${result.ok.note ? `. ${result.ok.note}` : ''}`
              : (said ?? result.error)}
        </p>
      </div>
      {alt && (
        <Button size="small" onClick={() => void stages.set('editor', alt.id).then(() => setResult(null))} data-testid="editor-use-other">
          Try {alt.name} for Edits
        </Button>
      )}
    </div>
  )
}

// ---- a model for each stage ----------------------------------------------------------------------------------

export const STAGES: { role: ModelRole; name: string; line: string }[] = [
  { role: 'editor', name: 'Edits', line: 'Makes Version 1 and the changes in your notes.' },
  { role: 'checker', name: 'Checks each edit', line: 'Checks each new version against your note, and Version 1’s subtitles.' },
  { role: 'writer', name: 'Writes scripts', line: 'Writes scripts, and a caption the editor left out.' },
  { role: 'planner', name: 'Plans reels', line: 'Talks a reel through with you before you film it.' },
  { role: 'finder', name: 'Finds more reels', line: 'Finds the other reels in a long video.' },
  { role: 'trial', name: 'Picks Try 2', line: 'Picks the one change for a second try at a post.' },
  { role: 'namer', name: 'Names versions', line: 'Rewords each version’s title. A small, fast model is enough.' }
]

const EFFORT_NAME: Record<string, string> = { none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' }
const FAMILY_NAME: Record<ModelFamily, string> = { claude: 'Claude', gpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', other: 'Other' }
const FAMILY_ORDER: ModelFamily[] = ['claude', 'gpt', 'gemini', 'grok', 'other']
const split = (choice: string): { id: string; effort?: string } => {
  const m = /^(.+)\(([a-z]+)\)$/.exec(choice)
  return m ? { id: m[1], effort: m[2] } : { id: choice }
}

function FamilyMark({ family, size = 14 }: { family: ModelFamily; size?: number }) {
  if (family === 'claude') return <BrandMark name="claude" size={size} />
  if (family === 'gpt') return <BrandMark name="openai" size={size} />
  return <Icon name="sparkles" size={size} />
}

export interface StageState {
  choice: ModelChoice | null
  models: EditorModel[]
  loading: boolean
  /** what Auto runs right now, per stage, by name */
  auto: Partial<Record<ModelRole, string | null>>
  /** the accounts behind the editor, shared by the limit bars, Test's offer and the picker's marks */
  accounts: EditorAccounts | null
  setAccounts: (a: EditorAccounts) => void
  reloadAccounts: () => void
  set: (role: ModelRole, value: string) => Promise<void>
}

/** The stage choices (AppInfo.models) and the editor's model list, kept together for the chips and Test's offer. */
export function useStages(active: ProviderInfo | null): StageState {
  const [choice, setChoice] = useState<ModelChoice | null>(null)
  const [models, setModels] = useState<EditorModel[]>([])
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState<Partial<Record<ModelRole, string | null>>>({})
  const [accounts, setAccounts] = useState<EditorAccounts | null>(null)
  const on = !!active?.connected && active.id !== 'none'
  const reloadAccounts = useCallback(() => {
    reel.ai.editorAccounts().then(setAccounts, () => setAccounts({ accounts: [], problem: 'Couldn’t read the accounts. Look again.' }))
  }, [])
  useEffect(() => {
    setAccounts(null)
    setAuto({})
    if (!on) return
    reloadAccounts()
    reel.ai.autoModels().then(setAuto, () => setAuto({}))
  }, [on, active?.id, active?.connectionId, reloadAccounts])
  useEffect(() => {
    let live = true
    reel.app.info().then((i) => live && setChoice(i.models), () => undefined)
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    let live = true
    setModels([])
    if (!on) return
    setLoading(true)
    reel.ai
      .editorModels()
      .then((m) => live && setModels(m), () => live && setModels([]))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [on, active?.id, active?.connectionId])
  const set = useCallback(
    async (role: ModelRole, value: string) => {
      const base = choice ?? (Object.fromEntries(MODEL_ROLES.map((r) => [r, 'auto'])) as ModelChoice)
      const info = await reel.app.setModels({ ...base, [role]: value })
      setChoice(info.models)
    },
    [choice]
  )
  return { choice, models, loading, auto, accounts, setAccounts, reloadAccounts, set }
}

/** One stage's chip: the provider's mark, the model's name and its reasoning level. */
function StageRow({ stage, state, editorPicksOwn, showLine }: { stage: (typeof STAGES)[number]; state: StageState; editorPicksOwn: boolean; showLine: boolean }) {
  const [open, setOpen] = useState(false)
  const chip = useRef<HTMLButtonElement>(null)
  const value = state.choice?.[stage.role] ?? 'auto'
  const { id, effort } = split(value)
  const model = state.models.find((m) => m.id === id)
  // a choice the editor in use doesn't offer is Auto, here as at edit time (ai index.ts modelForRole); Auto says what
  // it runs right now
  const missing = value !== 'auto' && !state.loading && state.models.length > 0 && !model
  // null: no model runs at all; Reel Studio writes the version names itself
  const autoName = state.auto[stage.role] === null ? 'Reel Studio’s own titles' : state.auto[stage.role]
  const label = value === 'auto' || missing ? (autoName ? `Auto · ${autoName}` : 'Auto') : (model?.name ?? idName(id))
  const lineId = `mrow-line-${stage.role}`
  return (
    <li className="mrow" data-testid={`stage-${stage.role}`}>
      <div className="mrow-t">
        <span className="mrow-name" id={`mrow-name-${stage.role}`}>
          {stage.name}
        </span>
        {showLine && (
          <span className="mrow-line" id={lineId}>
            {stage.line}
          </span>
        )}
        {missing && <span className="mrow-line warn">Your editor doesn’t offer {idName(id)} now, so Auto is used.</span>}
        {editorPicksOwn && stage.role === 'editor' && <span className="mrow-line">An API key picks its own model.</span>}
      </div>
      <button
        ref={chip}
        className={`mchip${missing ? ' warn' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `model-picker-${stage.role}` : undefined}
        aria-labelledby={`mrow-name-${stage.role} stage-chip-${stage.role}`}
        aria-describedby={showLine ? lineId : undefined}
        disabled={editorPicksOwn}
        title={editorPicksOwn ? 'This editor picks its own model.' : `${label}${effort ? ` · ${EFFORT_NAME[effort] ?? effort}` : ''}`}
        onClick={() => setOpen((o) => !o)}
        data-testid={`model-${stage.role}`}
      >
        {model && <FamilyMark family={model.family} />}
        <span className="mchip-name" id={`stage-chip-${stage.role}`}>
          {label}
          {effort && !missing && <span className="mchip-effort"> · {EFFORT_NAME[effort] ?? effort}</span>}
        </span>
        <Icon name="updown" size={12} />
      </button>
      {open && (
        <ModelPicker
          anchor={chip}
          stage={stage}
          value={value}
          models={state.models}
          loading={state.loading}
          auto={state.auto[stage.role] === null ? null : autoName}
          accounts={state.accounts?.accounts ?? []}
          onPick={(v) => void state.set(stage.role, v)}
          onClose={() => {
            setOpen(false)
            chip.current?.focus({ preventScroll: true })
          }}
        />
      )}
    </li>
  )
}

/**
 * The model for each stage. `open`: the list shows at once (Settings); otherwise it sits closed behind one line that
 * says what Edits uses (the first run's narrow column).
 */
export function StageModels({ active, state, open: startOpen }: { active: ProviderInfo; state: StageState; open: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const picksOwn = active.id === 'claude'
  const edits = state.choice?.editor ?? 'auto'
  // the models the stages run, by name: what each chose, or what its Auto runs
  const runs = STAGES.map(({ role }) => {
    const v = state.choice?.[role] ?? 'auto'
    const m = v !== 'auto' ? state.models.find((x) => x.id === split(v).id) : undefined
    return m?.name ?? state.auto[role]
  }).filter((n): n is string => !!n)
  const names = [...new Set(runs)]
  const summary = picksOwn ? 'This editor picks its own' : names.length ? names.join(', ') : 'Auto'
  return (
    <div className={`mstages${open ? ' open' : ''}`} data-testid="stage-models">
      <button className="mstages-h" aria-expanded={open} aria-controls="stage-list" onClick={() => setOpen((o) => !o)} data-testid="stage-models-toggle">
        <Icon name="chevron-right" size={14} stroke={2} className="chev" />
        <span className="mstages-title">Models</span>
        <span className="mstages-sum" title={edits !== 'auto' ? `Edits: ${edits}` : undefined}>
          {summary}
        </span>
      </button>
      <ul className="mrows" id="stage-list" hidden={!open}>
        {STAGES.map((s) => (
          <StageRow key={s.role} stage={s} state={state} editorPicksOwn={picksOwn} showLine={startOpen} />
        ))}
      </ul>
    </div>
  )
}

type Rect = { left: number; top: number; right: number; bottom: number }
const overlaps = (a: Rect, b: Rect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * Where the picker opens, given its size: under its chip, over it, or beside it on the left, whichever first fits
 * inside the window without covering the screen's main action (its filled button). The list shortens to fit when
 * none does.
 */
function place(anchor: HTMLElement, width: number, height: number, avoid: Rect[]): CSSProperties & { origin: string } {
  const r = anchor.getBoundingClientRect()
  const W = window.innerWidth
  const H = window.innerHeight
  const gap = 6
  const m = 8
  const x = Math.min(Math.max(m, r.right - width), W - width - m)
  const side = r.left - gap - width
  const ySide = Math.min(Math.max(m, r.top), H - height - m)
  const tries: (Rect & { origin: string })[] = [
    { left: x, top: r.bottom + gap, right: x + width, bottom: r.bottom + gap + height, origin: 'top right' },
    { left: x, top: r.top - gap - height, right: x + width, bottom: r.top - gap, origin: 'bottom right' },
    { left: side, top: ySide, right: side + width, bottom: ySide + height, origin: 'top right' }
  ]
  const fits = tries.find((t) => t.left >= m && t.top >= m && t.right <= W - m && t.bottom <= H - m && !avoid.some((a) => overlaps(t, a)))
  if (fits) return { position: 'fixed', left: fits.left, top: fits.top, width, maxHeight: height, origin: fits.origin }
  // nothing fits whole: the taller side of the chip, with a shorter list
  const below = H - r.bottom - gap - m
  const above = r.top - gap - m
  return below >= above
    ? { position: 'fixed', left: x, top: r.bottom + gap, width, maxHeight: Math.max(160, below), origin: 'top right' }
    : { position: 'fixed', left: x, bottom: H - r.top + gap, width, maxHeight: Math.max(160, above), origin: 'bottom right' }
}

/** The filled buttons on screen, outside `box`: the main actions a popover must leave visible. */
function mainActions(box: HTMLElement | null): Rect[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.btn.primary'))
    .filter((b) => !box?.contains(b) && b.offsetParent !== null)
    .map((b) => b.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
}

/**
 * T3 Code's model picker: a search box, then the models grouped by provider, the chosen one ticked, and the chosen
 * model's reasoning levels at the foot. It is drawn on the page's top layer (a portal), so no column or scroll area
 * clips it. Arrow keys move through the list, Enter picks, Escape closes.
 */
/** When a family's accounts are all at a limit: the earliest moment one of them is free again. Null when one has room
 * or there are no accounts to tell. */
export function familyAtLimit(accounts: EditorAccounts['accounts'], family: ModelFamily): string | null {
  const mine = accounts.filter((a) => (family === 'claude' ? a.provider === 'claude' : family === 'gpt' ? a.provider === 'codex' : false) && a.windows.length)
  if (!mine.length || !mine.every((a) => a.windows.some((w) => w.left === 0))) return null
  const free = mine.map((a) => a.windows.filter((w) => w.left === 0).map((w) => w.resetsAt ?? '').sort().at(-1) ?? '').filter(Boolean).sort()[0]
  return free ?? ''
}

function ModelPicker({ anchor, stage, value, models, loading, auto, accounts, onPick, onClose }: { anchor: React.RefObject<HTMLButtonElement | null>; stage: (typeof STAGES)[number]; value: string; models: EditorModel[]; loading: boolean; auto?: string | null; accounts: EditorAccounts['accounts']; onPick: (v: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [pos, setPos] = useState<(CSSProperties & { origin: string }) | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const { id: chosenId, effort } = split(value)
  const chosen = models.find((m) => m.id === chosenId)

  // placed twice: first at its widest to measure, then where its measured size fits
  useLayoutEffect(() => {
    // its whole height: the search and the reasoning row as drawn, and the list as long as all its models
    const natural = (): number => {
      const b = box.current
      if (!b) return 420
      return Array.from(b.children).reduce((h, c) => h + (c.classList.contains('mpop-list') ? c.scrollHeight : (c as HTMLElement).offsetHeight), 0)
    }
    const at = (): void => {
      if (!anchor.current) return
      setPos(place(anchor.current, Math.min(320, window.innerWidth - 16), Math.min(420, natural()), mainActions(box.current)))
    }
    // a scroll moves the chip: follow it, measuring at most once a frame and never inside the scroll event itself
    let frame = 0
    const onScroll = (e: Event): void => {
      if (box.current?.contains(e.target as Node) || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        at()
      })
    }
    at()
    window.addEventListener('resize', at)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('resize', at)
      window.removeEventListener('scroll', onScroll, true)
      cancelAnimationFrame(frame)
    }
    // placed again when the editor's model list arrives and the picker grows
  }, [anchor, models.length, loading])
  useEffect(() => {
    search.current?.focus({ preventScroll: true })
    const away = (e: PointerEvent): void => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !anchor.current?.contains(t)) onClose()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [anchor, onClose])

  const groups = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (m: EditorModel) => words.every((w) => `${m.name} ${m.id} ${FAMILY_NAME[m.family]}`.toLowerCase().includes(w))
    const names = new Map<string, number>()
    for (const m of models) names.set(m.name, (names.get(m.name) ?? 0) + 1)
    // a family whose accounts are all at a limit stays choosable, after the others, saying until when
    const groups = FAMILY_ORDER.map((f) => ({ family: f, until: familyAtLimit(accounts, f), items: models.filter((m) => m.family === f && hit(m)).map((m) => ({ m, twin: (names.get(m.name) ?? 0) > 1 })) })).filter((g) => g.items.length)
    return [...groups.filter((g) => g.until === null), ...groups.filter((g) => g.until !== null)]
  }, [models, q, accounts])
  const autoShown = !q.trim() || 'auto'.includes(q.trim().toLowerCase())

  const pick = (v: string): void => {
    onPick(v)
    onClose()
  }
  const move = (e: ReactKeyboardEvent): void => {
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[data-opt]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    const go = (j: number): void => items[Math.max(0, Math.min(items.length - 1, j))]?.focus()
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') i <= 0 ? search.current?.focus() : go(i - 1)
    else if (e.key === 'Home' && i >= 0) go(0)
    else if (e.key === 'End' && i >= 0) go(items.length - 1)
    else if (e.key === 'Escape') onClose()
    else if (e.key === 'Enter' && document.activeElement === search.current) items[0]?.click()
    else if (e.key === 'Tab') return void onClose()
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const { origin, ...style } = pos ?? { origin: 'top right', position: 'fixed' as const, left: -9999, top: 0, width: Math.min(320, window.innerWidth - 16), maxHeight: 420 }
  return createPortal(
    <div
      ref={box}
      id={`model-picker-${stage.role}`}
      className="mpop"
      style={{ ...style, '--o': origin } as CSSProperties}
      role="dialog"
      aria-label={`Model for ${stage.name}`}
      onKeyDown={move}
      data-testid="model-picker"
    >
      <div className="mpop-search">
        <Icon name="search" size={14} />
        <input
          ref={search}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          aria-controls={`model-list-${stage.role}`}
          aria-expanded
          aria-autocomplete="list"
          role="combobox"
          spellCheck={false}
          data-testid="model-search"
        />
      </div>
      <div className="mpop-list" role="listbox" id={`model-list-${stage.role}`} aria-label={`Models for ${stage.name}`}>
        {autoShown && (
          <button className="mopt" role="option" tabIndex={-1} aria-selected={value === 'auto'} data-opt onClick={() => pick('auto')} data-testid="model-opt-auto">
            <span className="mopt-mark">{value === 'auto' && <Icon name="check" size={14} stroke={2.4} />}</span>
            <span className="mopt-name">Auto</span>
            <span className="mopt-sub">{auto === null ? 'No model: Reel Studio writes them' : auto ? `Now ${auto}` : 'Your editor’s own choice'}</span>
          </button>
        )}
        {loading && (
          <p className="mpop-empty">
            <Spinner /> Asking your editor for its models…
          </p>
        )}
        {groups.map((g) => (
          <div key={g.family} role="group" aria-label={FAMILY_NAME[g.family]}>
            <p className="mpop-group" aria-hidden>
              {FAMILY_NAME[g.family]}
              {g.until !== null && <span className="mpop-group-note"> · at its limit{g.until ? ` until ${untilShort(g.until)}` : ''}</span>}
            </p>
            {g.items.map(({ m, twin }) => (
              <button
                key={m.id}
                className={`mopt${g.until !== null ? ' spent' : ''}`}
                role="option"
                tabIndex={-1}
                aria-selected={m.id === chosenId}
                aria-description={g.until !== null ? `Every ${FAMILY_NAME[g.family]} account is at its limit${g.until ? `, ${resetLong(g.until)}` : ''}` : undefined}
                data-opt
                onClick={() => pick(m.id)}
                title={m.id}
                data-testid={`model-opt-${m.id}`}
              >
                <span className="mopt-mark">{m.id === chosenId ? <Icon name="check" size={14} stroke={2.4} /> : <FamilyMark family={m.family} />}</span>
                <span className="mopt-name">{m.name}</span>
                {twin && <span className="mopt-sub">{m.id}</span>}
              </button>
            ))}
          </div>
        ))}
        {!loading && !groups.length && !autoShown && <p className="mpop-empty">No models match “{q.trim()}”.</p>}
        {!loading && !models.length && autoShown && <p className="mpop-empty">This editor lists no models. Auto lets it choose.</p>}
      </div>
      {chosen && chosen.efforts.length > 0 && (
        <div
          className="mpop-effort"
          role="radiogroup"
          aria-label={`Reasoning for ${chosen.name}`}
          onKeyDown={(e) => {
            // the levels are one stop: Left and Right move within them and never reach the list
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
            e.preventDefault()
            e.stopPropagation()
            const opts = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'))
            const i = opts.indexOf(document.activeElement as HTMLElement)
            const j = e.key === 'Home' ? 0 : e.key === 'End' ? opts.length - 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(opts.length - 1, i + 1)
            opts[j]?.focus()
            opts[j]?.click()
          }}
        >
          <span className="mpop-effort-h">Reasoning</span>
          <div className="ed-seg">
            {['', ...chosen.efforts].map((e) => {
              const on = (effort ?? '') === e
              return (
                <button key={e || 'default'} role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={`ed-seg-o${on ? ' on' : ''}`} onClick={() => onPick(e ? `${chosen.id}(${e})` : chosen.id)} data-testid={`effort-${e || 'default'}`} title={e ? EFFORT_NAME[e] : `Default${chosen.defaultEffort ? ` (${EFFORT_NAME[chosen.defaultEffort]})` : ''}`}>
                  {e ? (EFFORT_NAME[e] ?? e).replace('Extra high', 'XHigh') : 'Default'}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}
