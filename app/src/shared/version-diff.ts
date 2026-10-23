// What a version changed, as before → after rows, read from the project.json each version saved
// (versions/vN/project.json, docs/versions.md) and each render's length. Keep free of Node and DOM imports.
import type { ProjectJson } from './api'
import { look, name, pos, size } from './describe'
import { clock } from './progress'
import { gainOf, gainText, momentKey, musicFades, secondsText, sfxName } from './sfx'

export interface VersionRow {
  label: string
  /** '' for something the version added that had no "before" worth naming */
  before: string
  after: string
}

type Style = Record<string, unknown>
const SIZE = (s: Style): string => (size(s) < 95 ? 'Small' : size(s) > 115 ? 'Big' : 'Medium')
const POSITION = (s: Style): string => (pos(s) < 0.69 ? 'Higher' : 'Lower')
const LOOK: Record<string, string> = { white: 'Plain', yellow: 'Yellow', box: 'Black box' }
const subtitlesOn = (p: ProjectJson | null): boolean => !!p && p.captions?.enabled !== false
const song = (p: ProjectJson | null): string => (p?.music?.enabled && p.music.track ? `“${name(p.music.track)}”` : 'None')
const count = (n: number, one: string, many: string): string => (n === 0 ? 'None' : n === 1 ? `1 ${one}` : `${n} ${many}`)
const coverFrame = (p: ProjectJson | null): string => (p?.cover ? `The ${clock(p.cover.atSourceTime)} frame` : 'None')

/**
 * `before` null: the first version, compared with the raw video (`lengths.before` = its length).
 * Lengths are seconds from each render; null when one is not known.
 */
export function versionRows(before: ProjectJson | null, after: ProjectJson, lengths: { before: number | null; after: number | null }): VersionRow[] {
  const rows: VersionRow[] = []
  const add = (label: string, a: string, b: string) => {
    if (a !== b) rows.push({ label, before: a, after: b })
  }
  if (lengths.before !== null && lengths.after !== null && Math.abs(lengths.before - lengths.after) >= 0.5) add('Length', clock(lengths.before), clock(lengths.after))

  const on = [subtitlesOn(before), subtitlesOn(after)]
  if (on[0] !== on[1]) add('Subtitles', on[0] ? 'On' : 'None', on[1] ? 'On' : 'None')
  else if (on[1] && before) {
    const a = (before.captions?.style ?? {}) as Style
    const b = (after.captions?.style ?? {}) as Style
    add('Subtitle size', SIZE(a), SIZE(b))
    add('Subtitle position', POSITION(a), POSITION(b))
    add('Subtitle look', LOOK[look(a)], LOOK[look(b)])
    const fixed = (after.captions?.corrections?.length ?? 0) - (before.captions?.corrections?.length ?? 0)
    if (fixed > 0) rows.push({ label: 'Words fixed', before: '', after: String(fixed) })
  }

  add('Music', song(before), song(after))
  if (before && song(before) === song(after) && after.music?.enabled && before.music?.level !== after.music?.level) {
    add('Music volume', before.music?.level === 'quiet' ? 'Quiet' : 'Normal', after.music?.level === 'quiet' ? 'Quiet' : 'Normal')
  }
  if (before && song(before) === song(after) && after.music?.enabled) {
    const [a, b] = [musicFades(before.music), musicFades(after.music)]
    add('Music fade-in', secondsText(a.fadeIn), secondsText(b.fadeIn))
    add('Music fade-out', secondsText(a.fadeOut), secondsText(b.fadeOut))
  }
  add('Sound effects', count(before?.sfx?.length ?? 0, 'sound effect', 'sound effects'), count(after.sfx?.length ?? 0, 'sound effect', 'sound effects'))
  const was = new Map((before?.sfx ?? []).map((x) => [momentKey(x.at), x]))
  for (const x of after.sfx ?? []) {
    const a = was.get(momentKey(x.at))
    if (a && a.sound === x.sound) add(`${sfxName(x.sound).kind} level`, gainText(gainOf(a)), gainText(gainOf(x)))
  }
  add('Pictures', count(before?.broll?.length ?? 0, 'picture', 'pictures'), count(after.broll?.length ?? 0, 'picture', 'pictures'))
  add('Zooms', count(before?.zooms?.length ?? 0, 'zoom', 'zooms'), count(after.zooms?.length ?? 0, 'zoom', 'zooms'))
  add('Cover', coverFrame(before), coverFrame(after))
  add('Cover words', before?.cover?.text ? `“${before.cover.text}”` : 'None', after.cover?.text ? `“${after.cover.text}”` : 'None')
  return rows
}
