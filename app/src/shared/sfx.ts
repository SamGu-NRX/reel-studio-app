// The engine's built-in sound effects (engine/reelengine/sfx/pack.json) in plain words, so a person can tell
// what each one is ("Whoosh, quick") and why it plays where it does. No Node or DOM imports.
import type { ProjectJson } from './api'

export type Sfx = NonNullable<ProjectJson['sfx']>[number]

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

const KIND: Record<string, string> = {
  whoosh: 'Whoosh',
  pop: 'Pop',
  click: 'Click',
  riser: 'Build-up',
  impact: 'Hit',
  ding: 'Ding',
  typing: 'Typing'
}
const VARIANT: Record<string, string> = {
  'impact-subdrop': 'deep drop',
  'impact-hit': 'hard',
  'riser-subtle': 'soft',
  'ding-ting': 'bell',
  'typing-mech': 'mechanical',
  'typing-key': 'one key'
}

export const kindName = (kind: string): string => KIND[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)

/** "Whoosh" for the row, "quick" for the choice within it. */
export function sfxName(id: string): { kind: string; variant: string } {
  const [kind, ...rest] = id.split('-')
  return { kind: kindName(kind), variant: VARIANT[id] ?? rest.join(' ') }
}

/** Levels a person picks from, as the engine's gainDb on top of its own level under the voice. */
export const SFX_LEVELS = [
  { key: 'soft', label: 'Soft', gainDb: -8 },
  { key: 'normal', label: 'Normal', gainDb: 0 },
  { key: 'strong', label: 'Strong', gainDb: 6 }
] as const

export function levelOf(s: Sfx): (typeof SFX_LEVELS)[number]['key'] {
  const g = Number(s.gainDb ?? 0)
  return g <= -4 ? 'soft' : g >= 3 ? 'strong' : 'normal'
}

/** The transcript word a sound is placed on: the word, the start of the picture, or the first word after the cut. */
export function sfxWord(s: Sfx, broll: ProjectJson['broll']): string | null {
  if (s.at.word) return s.at.word
  if (s.at.cut) return s.at.cut
  if (s.at.broll) return broll?.find((b) => b.id === s.at.broll)?.anchor.from ?? null
  return null
}

/** Why it plays there, in words: "On the cut", "As the picture comes in", "On “flour”". */
export function sfxReason(s: Sfx, said: (id: string) => string | undefined): string {
  if (s.at.cut) return 'On a cut'
  if (s.at.broll) return 'As a picture comes in'
  const w = s.at.word ? said(s.at.word)?.replace(/[.,!?;:]+$/, '') : undefined
  return w ? `On “${w}”` : 'On a word'
}
