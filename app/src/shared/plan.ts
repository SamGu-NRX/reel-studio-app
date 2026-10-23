// A reel's plan (api.ts ReelPlan): its shape, checked where it is saved, and what it becomes for the editor's next
// planning turn, for Copy and the phone, and for the first edit. Keep free of Node and DOM imports.
import type { ChatMessage, PlanLine, ReelPlan } from './api'

export const PLAN_MAX = { hooks: 3, beats: 6, shots: 6, line: 160, topic: 200 } as const

const bad = (userMessage: string): { code: string; userMessage: string } => ({ code: 'BAD_PLAN', userMessage })

function line(v: unknown, what: string, max: number = PLAN_MAX.line): string {
  if (typeof v !== 'string') throw bad(`${what} is missing.`)
  const t = v.replace(/\s+/g, ' ').trim()
  if (!t) throw bad(`${what} is empty.`)
  if (t.length > max) throw bad(`${what} is longer than ${max} characters.`)
  return t
}

function lines(v: unknown, what: string, min: number, max: number): PlanLine[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw bad(min === max ? `A plan has ${min} ${what}.` : `A plan has ${min} to ${max} ${what}.`)
  return v.map((x, i) => {
    const o = (x ?? {}) as { text?: unknown; done?: unknown }
    if (o.done !== undefined && typeof o.done !== 'boolean') throw bad(`Line ${i + 1} of the ${what} is neither done nor to do.`)
    return { text: line(o.text, `Line ${i + 1} of the ${what}`), ...(o.done ? { done: true } : {}) }
  })
}

/** The plan as it is saved: 1 to 3 hooks with one picked, 1 to 6 beats and up to 6 shots, each one line. Throws a
 * BAD_PLAN error that says what is wrong; nothing is guessed or dropped. */
export function checkPlan(v: unknown): ReelPlan {
  if (!v || typeof v !== 'object') throw bad('There is no plan to save.')
  const p = v as Record<string, unknown>
  const topic = typeof p.topic === 'string' ? p.topic.replace(/\s+/g, ' ').trim() : null
  if (topic === null) throw bad("What it's about is missing.")
  if (topic.length > PLAN_MAX.topic) throw bad(`What it's about is longer than ${PLAN_MAX.topic} characters.`)
  if (!Array.isArray(p.hooks) || p.hooks.length < 1 || p.hooks.length > PLAN_MAX.hooks) throw bad(`A plan has 1 to ${PLAN_MAX.hooks} hooks.`)
  const hooks = p.hooks.map((h, i) => line(h, `Hook ${i + 1}`))
  if (!Number.isInteger(p.hook) || (p.hook as number) < 0 || (p.hook as number) >= hooks.length) throw bad('No hook is picked.')
  return { topic, hooks, hook: p.hook as number, beats: lines(p.beats, 'beats', 1, PLAN_MAX.beats), shots: lines(p.shots, 'shots', 0, PLAN_MAX.shots) }
}

/** A plan the editor proposed, as the reel keeps it: its first hook picked, nothing ticked off yet. */
export function planFromEditor(topic: string, r: { hooks: string[]; beats: string[]; shots: string[] }): ReelPlan {
  return checkPlan({ topic: topic.slice(0, PLAN_MAX.topic), hooks: r.hooks, hook: 0, beats: r.beats.map((text) => ({ text })), shots: r.shots.map((text) => ({ text })) })
}

export const pickedHook = (p: ReelPlan): string => p.hooks[p.hook] ?? p.hooks[0]

/** "5 beats, 3 shots" */
export function planCounts(p: ReelPlan): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  return p.shots.length ? `${n(p.beats.length, 'beat')}, ${n(p.shots.length, 'shot')}` : n(p.beats.length, 'beat')
}

/** The plan as plain text, for Copy: the title, the picked hook, the beats in order, then the shots. */
export function planText(p: ReelPlan, title: string): string {
  return [
    title,
    '',
    `Hook: ${pickedHook(p)}`,
    '',
    'Beats',
    ...p.beats.map((b, i) => `${i + 1}. ${b.text}`),
    ...(p.shots.length ? ['', 'Shots', ...p.shots.map((s) => `- ${s.text}`)] : [])
  ].join('\n')
}

/**
 * project.json `script` once the video arrives (main store.ts carryScript). The first edit reads the hook, the beats as
 * the lines they meant to say and the shots (ai editor.ts plannedScript); the listening model takes its words as hints
 * (engine transcribe.py _script_text).
 */
export function planAsScript(p: ReelPlan): { hook: string; script: string; shots: string[] } {
  return { hook: pickedHook(p), script: p.beats.map((b) => b.text).join('\n'), shots: p.shots.map((s) => s.text) }
}

export type PlanTurn = { from: 'you'; text: string } | { from: 'editor'; text: string; kind: 'question' | 'plan' }

/** The planning chat for the editor's next turn (ai PlanTurnInput): what the creator said, minus words they stopped or
 * that failed (Send again says them anew), the editor's questions and plans, and how many questions it has asked. */
export function planTurns(chat: ChatMessage[]): { turns: PlanTurn[]; asked: number } {
  const turns: PlanTurn[] = []
  for (const m of chat) {
    if (!m.plan) continue
    if (m.from === 'you' && m.outcome !== 'stopped' && m.outcome !== 'failed') turns.push({ from: 'you', text: m.text })
    else if (m.from === 'editor' && m.planTurn) turns.push({ from: 'editor', text: m.text, kind: m.planTurn })
  }
  return { turns, asked: turns.filter((t) => t.from === 'editor' && t.kind === 'question').length }
}

/** A New reel's name from what the plain form says it's about: up to 48 characters, cut at a word, capitalised. */
export function titleFromTopic(topic: string): string {
  const t = topic.replace(/\s+/g, ' ').trim()
  const cut = t.length > 48 ? t.slice(0, 48).replace(/\s+\S*$/, '') || t.slice(0, 48) : t
  return cut.charAt(0).toUpperCase() + cut.slice(1)
}
