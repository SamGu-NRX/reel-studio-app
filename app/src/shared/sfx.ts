// The engine's built-in sound effects (engine/reelengine/sfx/pack.json) and the music's fades, in plain words, so
// a person can tell what each sound is for ("Whoosh at 0:04 · as the picture changes") and where it plays.
// No Node or DOM imports.
import type { PlacedWord, ProjectJson, Word } from './api'
import type { RenderSegment } from './moments'
import { clock } from './progress'

export type Sfx = NonNullable<ProjectJson['sfx']>[number]
export type SfxMoment = Sfx['at']

/** One sound of the pack, as main lists it for the page. */
export interface SoundEffect {
  id: string
  kind: string
  seconds: number
  /** where the sound's hit is, from its start (the engine lines this up with the moment) */
  onsetMs: number
  /** reel-media URL of the .opus file */
  url: string
}

/** Each job in the pack, named for a person, with what it is for. The order is the picker's. */
export const JOBS: { kind: string; name: string; purpose: string }[] = [
  { kind: 'whoosh', name: 'Whoosh', purpose: 'for a cut' },
  { kind: 'impact', name: 'Hit', purpose: 'to land a big moment' },
  { kind: 'pop', name: 'Pop', purpose: 'when something appears' },
  { kind: 'riser', name: 'Build-up', purpose: 'rises into a moment' },
  { kind: 'ding', name: 'Ding', purpose: 'for a good point' },
  { kind: 'click', name: 'Click', purpose: 'for a tap or a tick' },
  { kind: 'typing', name: 'Typing', purpose: 'when words appear' }
]
const VARIANT: Record<string, string> = {
  'impact-subdrop': 'deep drop',
  'impact-hit': 'hard',
  'riser-subtle': 'soft',
  'ding-ting': 'bell',
  'typing-mech': 'mechanical',
  'typing-key': 'one key'
}

export const kindName = (kind: string): string => JOBS.find((j) => j.kind === kind)?.name ?? kind.charAt(0).toUpperCase() + kind.slice(1)

/** "Whoosh" for the row, "quick" for the choice within it. */
export function sfxName(id: string): { kind: string; variant: string } {
  const [kind, ...rest] = id.split('-')
  return { kind: kindName(kind), variant: VARIANT[id] ?? rest.join(' ') }
}

/**
 * The level slider's range, in dB on top of the engine's own level under the voice. The schema takes -24 to +12,
 * but sfx.py puts an effect 10 dB under the voice (LEVEL_DB) and never above 4 dB under it (CAP_DB): anything over
 * +6 sounds the same as +6, so the slider stops there.
 */
export const SFX_GAIN = { min: -24, max: 6 }

/** "−6 dB", "0 dB", "+3 dB": a real minus sign, so the numbers line up. */
export const gainText = (db: number): string => (db === 0 ? '0 dB' : `${db > 0 ? '+' : '−'}${Math.abs(db)} dB`)

/** The level a sound's slider shows: the engine's gainDb, held to the slider's range. */
export const gainOf = (s: Sfx): number => Math.min(SFX_GAIN.max, Math.max(SFX_GAIN.min, Math.round(Number(s.gainDb ?? 0))))

/** How loud a preview plays a sound, from its level: half volume at 0 dB, full at the top of the slider. */
export const sfxVolume = (s: Sfx): number => Math.min(1, 0.5 * 10 ** (gainOf(s) / 20))

/**
 * The sounds the player has to add while Edit it myself is open: those the version on screen doesn't already
 * play, because their moment or their sound is new. A sound that only changed level is left to the version, which
 * plays it at the old level: adding it again would play it twice, louder even when it was turned down.
 */
export function newToTheEar(before: Sfx[], now: Sfx[]): Sfx[] {
  const had = new Map(before.map((x) => [momentKey(x.at), x.sound]))
  return now.filter((x) => had.get(momentKey(x.at)) !== x.sound)
}

/** "a quieter whoosh", "a louder hit": a level change on one sound, in words. */
export const levelChange = (before: Sfx, after: Sfx): string => `a ${gainOf(after) < gainOf(before) ? 'quieter' : 'louder'} ${sfxName(after.sound).kind.toLowerCase()}`

/** The engine plays one sound at a time, at most one every two seconds (sfx.py MIN_GAP). */
export const SFX_GAP = 2

/** The moment as hand-edit.ts keys it: one sound per moment. */
export const momentKey = (at: SfxMoment): string => JSON.stringify(at)

/** Where the version on screen plays each word and each kept span, and which words its cut keeps. */
export interface VersionClock {
  placed: Map<string, PlacedWord>
  segments: RenderSegment[]
  words: Word[]
  kept: Set<string>
}

/** A join between two kept spans, on the version's clock. `cut`: the word after it starts a kept range of the
 * cut, so a sound can be placed on it as `{cut}` (sfx.py places those only after the first range). */
export interface Join {
  t: number
  cut: string | null
  /** The voice crossing the cut, as the render made it: `j`, the next span's voice starts `seconds` before its
   * picture; `l`, the last span's voice runs on `seconds` over the next picture. null: a plain cut. */
  bridge: { kind: 'j' | 'l'; seconds: number } | null
}

/**
 * Every join in the render: where one kept span ends and the next begins. At a plain cut the render fades the voice
 * out and in over a few milliseconds (render.py, the voice's afade), so none clicks. At a J or L join (project.json
 * `cut.keep[].join`) the voice crosses the cut instead, by as much as the engine found room for (render.json
 * segmentsDetail `audio_lead` and `audio_tail`, which are 0 when it found none).
 */
export function joinsOf(c: VersionClock): Join[] {
  const index = new Map(c.words.map((w, i) => [w.id, i]))
  const byTime = [...c.placed.values()].sort((a, b) => a.s - b.s)
  const segs = [...c.segments].sort((a, b) => a.out_start - b.out_start)
  return segs.slice(1).map((seg, n) => {
    const end = seg.out_start + (seg.src_end - seg.src_start)
    const first = byTime.find((w) => w.s >= seg.out_start - 1e-3 && w.s < end)
    const i = first ? index.get(first.id) : undefined
    const word = i === undefined ? undefined : c.words[i]
    const prev = i ? c.words[i - 1] : undefined
    // a span after a trimmed pause carries on the range before it; only a range's first word starts a cut
    const startsRange = !!word && !(prev && c.kept.has(prev.id) && (prev.source ?? 's1') === (word.source ?? 's1'))
    const lead = seg.audio_lead ?? 0
    const tail = segs[n].audio_tail ?? 0
    const bridge = lead > 0 ? { kind: 'j' as const, seconds: lead } : tail > 0 ? { kind: 'l' as const, seconds: tail } : null
    return { t: seg.out_start, cut: startsRange ? word!.id : null, bridge }
  })
}

/** The Sound tab's line about the cuts: what the voice does at each, in words. null with no cuts. */
export function cutsHint(joins: Join[]): string | null {
  if (!joins.length) return null
  const j = joins.filter((x) => x.bridge?.kind === 'j').length
  const l = joins.filter((x) => x.bridge?.kind === 'l').length
  const plain = joins.length - j - l
  const many = (n: number, one: string, more: string): string => (n === 1 ? one : more.replace('#', String(n)))
  if (!j && !l)
    return `Your voice fades out and back in at ${many(plain, 'the cut', 'each of the # cuts')}, marked on the timeline, so ${many(plain, 'it never clicks', 'none of them clicks')}.`
  const lines = [
    j ? `At ${many(j, 'one cut', '# cuts')} your next line starts a moment before its picture.` : '',
    l ? `At ${many(l, 'one cut', '# cuts')} your line carries on a moment over the next picture.` : '',
    plain ? `At ${many(plain, 'the other cut', 'the other # cuts')} your voice fades out and back in, so ${many(plain, 'it never clicks', 'none of them clicks')}.` : '',
    'The timeline marks each cut.'
  ]
  return lines.filter(Boolean).join(' ')
}

/** Where a sound's hit lands in the version on screen, or null when the version has no such moment. A picture's
 * sound is shown at its first word; the engine starts it a little earlier, with the picture's lead-in. */
export function soundTime(s: Sfx, c: VersionClock, joins: Join[], broll: ProjectJson['broll']): number | null {
  if (s.at.cut) return joins.find((j) => j.cut === s.at.cut)?.t ?? null
  const word = s.at.word ?? broll?.find((b) => b.id === s.at.broll)?.anchor.from
  return word ? (c.placed.get(word)?.s ?? null) : null
}

/** The transcript word a sound depends on: if a hand edit cuts it, the sound has nowhere to play. */
export function sfxWord(s: Sfx, broll: ProjectJson['broll']): string | null {
  if (s.at.word) return s.at.word
  if (s.at.cut) return s.at.cut
  if (s.at.broll) return broll?.find((b) => b.id === s.at.broll)?.anchor.from ?? null
  return null
}

/**
 * Why a sound plays where it does: "on a cut", "as a picture comes in", "on “flour”". A join is called a cut
 * on screen: it is where the Cut tab took something out, and "join" already means joining subtitle lines.
 */
export function momentWhy(at: SfxMoment, said: (id: string) => string | undefined): string {
  if (at.cut) return 'on a cut'
  if (at.broll) return 'as a picture comes in'
  const w = at.word ? said(at.word)?.trim().replace(/[.,!?;:]+$/, '') : undefined
  return w ? `on “${w}”` : 'on a word'
}

/** "Whoosh at 0:04", or "Whoosh" when the version has no such moment. */
export const soundTitle = (s: Sfx, t: number | null): string => (t === null ? sfxName(s.sound).kind : `${sfxName(s.sound).kind} at ${clock(t)}`)

/**
 * The moment a sound added at `t` goes on: the join there if the cut starts a range at it (within a third of a
 * second), else the word playing at `t` or the next one. A moment that has a sound already is passed over.
 */
export function momentAt(t: number, c: VersionClock, joins: Join[], taken: Set<string>): { at: SfxMoment; t: number } | null {
  const join = joins.find((j) => j.cut && Math.abs(j.t - t) <= 0.35 && !taken.has(momentKey({ cut: j.cut })))
  if (join) return { at: { cut: join.cut! }, t: join.t }
  const word = [...c.placed.values()].sort((a, b) => a.s - b.s).find((w) => w.e > t && !taken.has(momentKey({ word: w.id })))
  return word ? { at: { word: word.id }, t: word.s } : null
}

/** Where picking a sound puts the playhead: a second before its moment, so Play runs into it and the playhead
 * doesn't cover its mark. */
export const leadIn = (t: number): number => Math.max(0, t - 1)

/** The sound the picker offers first for a moment: a whoosh on a cut, a pop on a word. */
export const firstChoice = (at: SfxMoment): string => (at.word ? 'pop-soft' : 'whoosh-quick')

/** The music's fade-in and fade-out in seconds, as music.py fade_lengths reads them (absent: its defaults). */
export function musicFades(m: ProjectJson['music']): { fadeIn: number; fadeOut: number } {
  return {
    fadeIn: typeof m?.fadeIn === 'number' ? m.fadeIn : m?.level === 'loud-intro' ? 0.05 : 0.6,
    fadeOut: typeof m?.fadeOut === 'number' ? m.fadeOut : 1.5
  }
}

/** What Edit it myself lets a person set a fade to, in seconds. */
export const FADE_MAX = 2

/** "0.6 s", "0.05 s", "2 s". */
export const secondsText = (s: number): string => `${Number(s.toFixed(2))} s`

/** One placed sound, in the words and the time the person sees. */
export interface SoundRow {
  s: Sfx
  key: string
  t: number | null
  title: string
  why: string
  /** why the engine will leave it out, or null */
  warn: string | null
}

/**
 * The reel's sounds in the order they play, each with what it is, when, why there, and whether it will play. With
 * the pack (`timing`, by sound id), the engine's other reasons hold too (sfx.py plan): a sound whose lead-up would
 * start before the video, and one that starts before the last placed one ends.
 */
export function soundRows(
  sfx: Sfx[],
  c: VersionClock,
  joins: Join[],
  broll: ProjectJson['broll'],
  keptNow: Set<string>,
  said: (id: string) => string | undefined,
  timing?: Map<string, Pick<SoundEffect, 'onsetMs' | 'seconds'>>
): SoundRow[] {
  const rows = sfx
    .map((s) => {
      const t = soundTime(s, c, joins, broll)
      const word = sfxWord(s, broll)
      const cut = !!word && !keptNow.has(word)
      return { s, key: momentKey(s.at), t, title: soundTitle(s, t), why: momentWhy(s.at, said), warn: cut ? "Its word is cut, so it won't play." : t === null ? "Its moment isn't in this version, so it won't play." : null }
    })
    .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity))
  // the engine plays one at a time, two seconds apart, each after the last one placed has ended
  let last: { t: number; end: number } | null = null
  for (const r of rows) {
    if (r.warn || r.t === null) continue
    const snd = timing?.get(r.s.sound)
    const start = r.t - (snd?.onsetMs ?? 0) / 1000
    if (start < 0) r.warn = "Too close to the start, so it won't play."
    else if (last && r.t - last.t < SFX_GAP) r.warn = "Less than 2 seconds after the sound before it, so it won't play. Remove one of them."
    else if (last && start < last.end) r.warn = "It starts before the sound before it ends, so it won't play. Remove one of them."
    else last = { t: r.t, end: start + (snd?.seconds ?? 0) }
  }
  return rows
}

/** The moments a new sound can't go on: one that has a sound, and a word (or the cut it starts) this edit cuts. */
export function takenMoments(rows: SoundRow[], c: VersionClock, keptNow: Set<string>): Set<string> {
  const taken = new Set(rows.map((r) => r.key))
  for (const id of c.placed.keys()) if (!keptNow.has(id)) taken.add(momentKey({ word: id })).add(momentKey({ cut: id }))
  return taken
}
