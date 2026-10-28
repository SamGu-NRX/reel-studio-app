// A reel's one state on Reels, Activity's groups (ux-foundation-b.md section 3.4) and the step a Making line names. Keep free of DOM imports:
// test/home-state.test.ts runs it in Node.
import type { ProjectSummary } from '../../../shared/api'
import { STEP_LABEL, type Step } from '../../../shared/steps'

export type CardState = 'novideo' | 'making' | 'paused' | 'failed' | 'ready'

/** "Recent" on Activity: reels with a version touched in the last two weeks. */
export const RECENT_DAYS = 14

/** A planned reel waits for its video whatever app.json says. */
export const stateOf = (p: ProjectSummary): CardState =>
  p.noVideo ? 'novideo' : p.status === 'working' || p.status === 'new' ? 'making' : p.status === 'interrupted' ? 'paused' : p.status === 'failed' ? 'failed' : 'ready'

/**
 * Activity, urgent first. Needs you holds what can't move without the person: a Version 1 that didn't finish (something
 * went wrong), then one they paused (their own choice), then reels still waiting for a video (nothing started yet).
 * Making holds what is being made, then pauses that continue on their own. Within a rank the list's own order stays.
 */
export function activity(list: ProjectSummary[], now: Date): { needs: ProjectSummary[]; making: ProjectSummary[]; recent: ProjectSummary[] } {
  const needsRank = (p: ProjectSummary): number => {
    const s = stateOf(p)
    if (s === 'failed') return 0
    if (s === 'paused' && !p.pausedFor) return 1
    if (s === 'novideo') return 2
    return -1
  }
  const makingRank = (p: ProjectSummary): number => {
    const s = stateOf(p)
    if (s === 'making') return 0
    if (s === 'paused' && p.pausedFor) return 1
    return -1
  }
  const ranked = (rank: (p: ProjectSummary) => number) =>
    list
      .map((p) => ({ p, r: rank(p) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.p)
  const recent = list.filter((p) => stateOf(p) === 'ready' && now.getTime() - new Date(p.versionAt ?? p.updatedAt).getTime() < RECENT_DAYS * 86_400_000)
  return { needs: ranked(needsRank), making: ranked(makingRank), recent }
}

/**
 * The step a Making line names, from a job's status event, in the words the Reel screen's progress strip uses
 * (Composer.tsx): Version 1's current step, unless the editor itself is being waited on; then, and for a note, what
 * the job says it is doing. null: nothing to name yet.
 */
export function stepWords(e: { message: string; waiting: boolean; steps?: Step[] }): string | null {
  if (e.steps && !e.waiting) {
    const now = e.steps.find((s) => s.state === 'now')
    return now ? STEP_LABEL[now.id] : null
  }
  return e.message.trim() || null
}
