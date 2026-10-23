// "Notes for your editor": the reel's history as one list, oldest first. Each entry is what you asked
// (your video, a note, or a change you made yourself) and what came of it. Built from app.json's chat and
// version records only. Keep free of Node and DOM imports.
import type { ChatAction, ChatMessage, NoteAttachment, NoteMoment, VersionInfo, VersionMade } from './api'

export type LogAsk =
  | { kind: 'video'; text: string }
  | { kind: 'note'; text: string; moment: NoteMoment | null; attachments: NoteAttachment[] }
  | { kind: 'hand'; text: string }

export type LogResult =
  | { kind: 'version'; v: number; text: string }
  | { kind: 'making'; v: number }
  | { kind: 'failed'; text: string }
  | { kind: 'stopped'; kept: number }
  /** an answer that made no version: the no-AI reply, or a question back */
  | { kind: 'reply'; text: string; actions: ChatAction[]; messageId: string }

export interface LogEntry {
  key: string
  /** set on the first entry of each day */
  day: string | null
  ask: LogAsk
  result: LogResult | null
  /** editor lines after the result, such as "Remember this for next time?" */
  extra: ChatMessage[]
}

const DONE_FAIL = "That didn't work, and nothing changed."

export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function notesLog(input: {
  chat: ChatMessage[]
  made: VersionMade[]
  versions: VersionInfo[]
  /** the job running now, if any, and whether it is the first edit or a change made by hand */
  running: { id: string; kind: 'first-edit' | 'note' | 'hand' } | null
  /** the raw take's file name */
  sourceName: string | null
  now: Date
}): LogEntry[] {
  const { chat, made, versions, running, now } = input
  const latest = versions[versions.length - 1]?.n ?? 0
  const first: LogEntry & { at: string } = {
    key: 'video',
    day: null,
    at: versions[0]?.createdAt ?? chat[0]?.at ?? now.toISOString(),
    ask: { kind: 'video', text: input.sourceName ? `Your video, ${input.sourceName}` : 'Your video' },
    result: null,
    extra: []
  }
  const entries: (LogEntry & { at: string; outcome?: ChatMessage['outcome']; jobId?: string })[] = [first]
  let open: (typeof entries)[number] | null = first

  for (const m of chat) {
    if (m.from === 'you') {
      open = { key: m.id, day: null, at: m.at, ask: { kind: 'note', text: m.text, moment: m.moment ?? null, attachments: m.attachments ?? [] }, result: null, extra: [], outcome: m.outcome, jobId: m.jobId }
      entries.push(open)
      continue
    }
    if (m.version !== undefined) {
      // a stopped or failed note made no version: one that follows it was made some other way
      if (open && !open.result && open.outcome !== 'stopped' && open.outcome !== 'failed') open.result = { kind: 'version', v: m.version, text: m.text }
      else {
        const record = made.find((r) => r.version === m.version && r.by === 'hand')
        const what = record?.summary.trim()
        open = { key: m.id, day: null, at: m.at, ask: { kind: 'hand', text: what ? `You changed ${what}` : 'You changed it yourself' }, result: { kind: 'version', v: m.version, text: m.text }, extra: [] }
        entries.push(open)
      }
      continue
    }
    const last = entries[entries.length - 1]
    if (open && open.ask.kind === 'note' && !open.result) {
      open.result = open.outcome === 'failed' ? { kind: 'failed', text: m.text } : { kind: 'reply', text: m.text, actions: m.actions ?? [], messageId: m.id }
    } else last.extra.push(m)
  }

  for (const e of entries) {
    if (e.result) continue
    if (e === first) {
      if (versions.length) e.result = { kind: 'version', v: versions[0].n, text: 'First cut' }
      else if (running?.kind === 'first-edit') e.result = { kind: 'making', v: 1 }
    } else if (running && e.jobId === running.id) e.result = { kind: 'making', v: latest + 1 }
    else if (e.outcome === 'stopped') e.result = { kind: 'stopped', kept: latest }
    else if (e.outcome === 'failed') e.result = { kind: 'failed', text: DONE_FAIL }
  }
  if (running?.kind === 'hand') entries.push({ key: running.id, day: null, at: now.toISOString(), ask: { kind: 'hand', text: 'Your changes' }, result: { kind: 'making', v: latest + 1 }, extra: [] })

  let day = ''
  return entries.map(({ key, at, ask, result, extra }) => {
    const label = dayLabel(at, now)
    const e: LogEntry = { key, day: label !== day ? label : null, ask, result, extra }
    day = label
    return e
  })
}
