// Try 2 for Share › Other platforms: the connected editor decides the one change; with no editor, or when its answer
// can't be used, the app picks another cover and says so without "I" (ux-foundation-b section 3.3).
import type { PlacedWord } from '../shared/api'
import { clock } from '../shared/progress'
import type { RenderSegment } from '../shared/moments'
import { appCoverPick, parseTryProposal, type TryProposal, type TryVariable } from '../shared/platforms'
import type { AI } from './ai-types'

/** Where source time `at` of `source` plays on a render's clock, or null when the render cut it. */
export function outputTime(segments: RenderSegment[], source: string, at: number): number | null {
  const seg = segments.find((s) => s.source === source && at >= s.src_start && at <= s.src_end)
  return seg ? seg.out_start + (at - seg.src_start) : null
}

export async function proposeTry({ ai, caption, variable, timeline, cover, log }: {
  ai: Pick<AI, 'active' | 'proposeTry'>
  caption: string
  variable?: TryVariable
  timeline: { duration: number; words: PlacedWord[]; segments: RenderSegment[] }
  /** The version's chosen cover in raw-take time (project.json `cover`), if it has one. */
  cover: { source: string; atSourceTime: number } | null
  log: (s: string) => void
}): Promise<{ proposal: TryProposal; notice?: string }> {
  const { duration, words } = timeline
  const coverSeconds = cover ? outputTime(timeline.segments, cover.source, cover.atSourceTime) : null
  const appCover = appCoverPick(duration, words, coverSeconds)
  const appPick = (): TryProposal => ({ variable: 'cover', value: appCover, reason: null })
  const active = await ai.active().catch(() => null)
  if (!active?.connected || active.id === 'none' || !ai.proposeTry) return { proposal: appPick() }
  try {
    const got = await ai.proposeTry({
      caption, duration, coverSeconds, ...(variable ? { variable } : {}),
      words: words.map((w) => ({ w: w.w, s: Math.round(w.s * 10) / 10, e: Math.round(w.e * 10) / 10 }))
    })
    const proposal = parseTryProposal(got, caption, duration)
    if (variable && proposal.variable !== variable) throw new Error(`asked for ${variable}, got ${proposal.variable}`)
    return { proposal }
  } catch (e) {
    log(`[try 2] the editor's proposal is not used: ${(e as { message?: string; userMessage?: string })?.userMessage ?? (e as Error)?.message ?? String(e)}`)
    // Share shows this in place of its own line, so Try 2 is said once, with the frame (audit-1028 finding 18)
    return { proposal: appPick(), notice: `Your editor didn’t pick a change, so Try 2 changes the cover to the ${clock(appCover)} frame.` }
  }
}
