// The contract's calls (shared/contract.ts), implemented once. The desktop window reaches them over IPC (index.ts)
// and a browser over the loopback server (server/); both go through `dispatch`, which checks the arguments first.
// No electron import: tests run it in Node with the stand-in engine and AI.
import type { AppInfo, ModelStatus, ProviderInfo, UpdateStatus } from '../shared/api'
import { checkArgs, type Method, type MethodResult } from '../shared/contract'
import { noAiReply } from '../shared/notes'
import type { AgentResult, AI } from './ai-types'
import { checkNoteAttachments, forChat } from './attachments'
import { publicInfo } from './claude-signin'
import type { JobManager } from './jobs'
import { addChat, detail, listProjects, projectDir } from './store'
import { rememberQuestion, styleConsent } from './style-consent'

export interface ServiceDeps {
  info(): Promise<AppInfo>
  /** The AI is loaded after the window opens, so it is looked up on each call. */
  ai(): AI
  jobs: JobManager
  models: { status(): ModelStatus | Promise<ModelStatus> }
  updates: { status(): Promise<UpdateStatus> }
}

type Handlers = { [M in Method]: (...args: any[]) => Promise<MethodResult<M>> }

/** Who is calling. A browser is a second, less trusted client: some results are trimmed for it (`forBrowser`). */
export interface Caller {
  browser?: boolean
}

/** Notes remembered by request id, so a retried submission is answered, not run again. Oldest forgotten first. */
const RECEIPTS = 200

/** A provider as a browser sees it: no `detail`, which holds a signed-in account's email or a dev fixture's path. */
function forBrowserProvider(p: ProviderInfo): ProviderInfo {
  return { id: p.id, connected: p.connected, label: p.label, ...(p.error ? { error: { code: p.error.code, userMessage: p.error.userMessage } } : {}) }
}

export function createService(d: ServiceDeps) {
  /** The editor's reply into the chat, then one "Remember this for next time?" per My style rule the AI
   * proposed or saved (a saved one is taken out again until the user says Yes): main/style-consent.ts. */
  async function replyAskingAboutStyle(slug: string, r: AgentResult, summary: string): Promise<{ summary: string; version: number; quiet: true }> {
    const ai = d.ai()
    const c = styleConsent(summary, r.styleRulesAdded, r.styleSuggestions)
    if (c.undo.length) {
      const rules = await ai.styleRules().catch(() => [])
      for (const rule of rules) if (c.undo.includes(rule.text)) await ai.removeStyleRule(rule.id).catch(() => undefined)
    }
    await addChat(slug, 'editor', c.summary, r.version)
    for (const rule of c.suggestions) await addChat(slug, 'editor', rememberQuestion(rule), undefined, ['remember-yes', 'remember-no'], rule)
    return { summary: c.summary, version: r.version, quiet: true }
  }

  const receipts = new Map<string, Promise<{ jobId: string | null }>>()

  async function sendNote(slug: string, text: string, attachments?: unknown): Promise<{ jobId: string | null }> {
    const note = text.trim()
    const dir = projectDir(slug)
    // never trust the page: every attached ref is re-read from THIS project's own sidecars
    const files = await checkNoteAttachments(dir, attachments)
    if (!note && !files.length) throw { code: 'EMPTY', userMessage: 'Type what you would like changed first.' }
    if (d.jobs.forSlug(slug)) throw { code: 'BUSY', userMessage: 'I am still working on this video. Give me a moment, or press Stop.' }
    await addChat(slug, 'you', note, undefined, undefined, undefined, files.map(forChat))
    const ai = d.ai()
    const active = await ai.active().catch(() => null)
    if (!active || !active.connected || active.id === 'none') {
      // No AI editor: nothing can apply the note, so do not pretend. Say what they can do instead
      // and offer the matching manual control plus "Connect ChatGPT" (grandma test, finding 8).
      const reply = noAiReply(note, files.length)
      await addChat(slug, 'editor', reply.text, undefined, reply.actions)
      return { jobId: null }
    }
    const jobId = d.jobs.start(
      slug,
      'note',
      async (emit, signal) => {
        const opts = files.length ? { attachments: files.map((f) => f.asset) } : undefined
        const r = await ai.applyNote(dir, note, (e) => emit(e), signal, opts)
        const extra = r.notice?.userMessage ? ` ${r.notice.userMessage}` : ''
        return replyAskingAboutStyle(slug, r, r.summary + extra)
      },
      { note: note || files.map((f) => f.name).join(', ') }
    )
    return { jobId }
  }

  const handlers: Handlers = {
    'app.info': () => d.info(),
    'projects.list': () => listProjects(),
    'projects.get': async (slug: string) => {
      const p = await detail(slug)
      const running = d.jobs.forSlug(slug)
      p.job = running
        ? { id: running.id, kind: running.kind, message: running.message, pct: running.pct, overall: running.overall, secondsLeft: running.secondsLeft, overdue: running.overdue, thinking: running.thinking }
        : null
      if (!running && p.status === 'working') p.status = 'interrupted'
      return p
    },
    'ai.active': () => d.ai().active(),
    'ai.providers': () => d.ai().providers(),
    // The page gets the state only; the sign-in happens in Anthropic's CLI (desktop).
    'ai.claudeCodeStatus': async () => publicInfo((await d.ai().claudeCodeStatus?.()) ?? { state: 'missing' }),
    'model.status': async () => d.models.status(),
    'update.status': () => d.updates.status(),
    'style.rules': () => d.ai().styleRules(),
    // jobId null = no AI connected: the note and a plain reply go into the chat, nothing runs. A request id seen
    // before gets the first answer (a page that lost the reply and retried must not run, and pay for, the note twice).
    'projects.note': (slug: string, text: string, attachments?: unknown, requestId?: string) => {
      if (!requestId) return sendNote(slug, text, attachments)
      const seen = receipts.get(requestId)
      if (seen) return seen
      const p = sendNote(slug, text, attachments)
      receipts.set(requestId, p)
      if (receipts.size > RECEIPTS) receipts.delete(receipts.keys().next().value!)
      p.catch(() => receipts.delete(requestId)) // nothing ran: a retry may try again
      return p
    },
    'jobs.cancel': async (id: string) => d.jobs.cancel(id)
  }

  return {
    replyAskingAboutStyle,
    /** Runs one call after checking its arguments. Throws a UserError-shaped value on failure. */
    async dispatch(method: unknown, args: unknown, caller: Caller = {}): Promise<unknown> {
      const checked = checkArgs(method, args)
      const out = await (handlers[method as Method] as (...a: unknown[]) => Promise<unknown>)(...checked)
      if (!caller.browser) return out
      if (method === 'ai.active') return forBrowserProvider(out as ProviderInfo)
      if (method === 'ai.providers') return (out as ProviderInfo[]).map(forBrowserProvider)
      return out
    }
  }
}

export type Service = ReturnType<typeof createService>
