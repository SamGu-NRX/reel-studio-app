import { describe, expect, it } from 'vitest'
import type { PlacedWord, ProjectJson, Word } from '../src/shared/api'
import { describeChange } from '../src/shared/describe'
import { countChanges, diffProject } from '../src/shared/hand-edit'
import { placeWords, type RenderSegment } from '../src/shared/moments'
import { gainOf, joinsOf, momentAt, momentKey, momentWhy, musicFades, soundTime, soundTitle, type VersionClock } from '../src/shared/sfx'
import { versionRows } from '../src/shared/version-diff'

// w0..w9 said one every 0.5 s. The cut keeps w0-w3 and w6-w9; the render also trims the pause inside w0-w3.
const words: Word[] = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, w: ['so', 'flour', 'water', 'salt', 'um', 'uh', 'then', 'fold', 'it', 'twice'][i], s: i * 0.5, e: i * 0.5 + 0.3, source: 's1' }))
const segments: RenderSegment[] = [
  { source: 's1', src_start: 0, src_end: 0.85, out_start: 0 },
  { source: 's1', src_start: 0.95, src_end: 1.85, out_start: 0.85 },
  { source: 's1', src_start: 2.95, src_end: 4.85, out_start: 1.75 }
]
const kept = new Set(['w0', 'w1', 'w2', 'w3', 'w6', 'w7', 'w8', 'w9'])
const clockOf = (): VersionClock => {
  const placed = new Map<string, PlacedWord>(placeWords(segments, words).map((w) => [w.id, w]))
  return { placed, segments, words, kept }
}

describe('sound moments', () => {
  it('fails if a trimmed pause is offered as a cut (the engine only places {cut} where a kept range starts)', () => {
    expect(joinsOf(clockOf())).toEqual([
      { t: 0.85, cut: null },
      { t: 1.75, cut: 'w6' }
    ])
  })

  it('fails if a sound added near a change of picture is not put on it, or one on a moment with a sound is', () => {
    const c = clockOf()
    const joins = joinsOf(c)
    expect(momentAt(1.6, c, joins, new Set())).toEqual({ at: { cut: 'w6' }, t: 1.75 })
    // the change of picture has a sound: the word playing then
    expect(momentAt(1.6, c, joins, new Set([momentKey({ cut: 'w6' })]))).toEqual({ at: { word: 'w3' }, t: 1.4 })
    expect(momentAt(0.6, c, joins, new Set())).toEqual({ at: { word: 'w1' }, t: 0.5 })
    expect(momentAt(0.6, c, joins, new Set([momentKey({ word: 'w1' })]))?.at).toEqual({ word: 'w2' })
  })

  it('fails if a sound is timed off its moment in the version, or a cut-out word still has a time', () => {
    const c = clockOf()
    const joins = joinsOf(c)
    expect(soundTime({ at: { cut: 'w6' }, sound: 'whoosh-quick' }, c, joins, [])).toBe(1.75)
    expect(soundTime({ at: { word: 'w7' }, sound: 'pop-soft' }, c, joins, [])).toBeCloseTo(2.3)
    expect(soundTime({ at: { broll: 'b1' }, sound: 'pop-soft' }, c, joins, [{ id: 'b1', anchor: { from: 'w2', to: 'w3' }, treatment: 'card' } as never])).toBeCloseTo(0.9)
    expect(soundTime({ at: { word: 'w4' }, sound: 'pop-soft' }, c, joins, [])).toBeNull()
  })

  it('fails if a sound is named by its file rather than what it is and why it plays there', () => {
    const said = (id: string) => words.find((w) => w.id === id)?.w
    expect(`${soundTitle({ at: { cut: 'w6' }, sound: 'whoosh-quick' }, 4.2)} · ${momentWhy({ cut: 'w6' }, said)}`).toBe('Whoosh at 0:04 · as the picture changes')
    expect(`${soundTitle({ at: { word: 'w1' }, sound: 'impact-subdrop' }, 0.5)} · ${momentWhy({ word: 'w1' }, said)}`).toBe('Hit at 0:01 · on “flour”')
    expect(momentWhy({ broll: 'b1' }, said)).toBe('as a picture comes in')
  })

  it('fails if the slider shows a level the engine would not play (it caps at +6 dB)', () => {
    expect(gainOf({ at: { word: 'w1' }, sound: 'pop-soft', gainDb: 12 })).toBe(6)
    expect(gainOf({ at: { word: 'w1' }, sound: 'pop-soft', gainDb: -30 })).toBe(-24)
    expect(gainOf({ at: { word: 'w1' }, sound: 'pop-soft' })).toBe(0)
  })
})

describe('music fades', () => {
  it("fails if the fades shown are not the ones music.py uses when the project doesn't set them", () => {
    expect(musicFades({ enabled: true, track: 'x.mp3' })).toEqual({ fadeIn: 0.6, fadeOut: 1.5 })
    expect(musicFades({ enabled: true, track: 'x.mp3', level: 'loud-intro' })).toEqual({ fadeIn: 0.05, fadeOut: 1.5 })
    expect(musicFades({ enabled: true, track: 'x.mp3', fadeIn: 0, fadeOut: 0.3 })).toEqual({ fadeIn: 0, fadeOut: 0.3 })
  })
})

const project = (patch: Partial<ProjectJson> = {}): ProjectJson =>
  ({
    schemaVersion: 1, id: 'p', title: 'T', slug: 't', createdAt: '', updatedAt: '', version: 2,
    sources: [{ id: 's1', path: 'media/s1.mov' }],
    music: { enabled: true, track: 'Library/Music/Morning light.mp3' },
    sfx: [
      { at: { word: 'w1' }, sound: 'pop-soft' },
      { at: { cut: 'w6' }, sound: 'whoosh-quick' }
    ],
    ...patch
  }) as ProjectJson

describe('a sound and fade edit, counted and described', () => {
  const before = project()
  const after = project({
    music: { enabled: true, track: 'Library/Music/Morning light.mp3', fadeIn: 1.2, fadeOut: 0.5 },
    sfx: [
      { at: { cut: 'w6' }, sound: 'whoosh-quick', gainDb: -6 },
      { at: { word: 'w8' }, sound: 'impact-punch' }
    ]
  })

  it('fails if a fade-in and a fade-out are counted as one change, or as a new song', () => {
    const k = new Set(['w1'])
    // fade-in, fade-out, a level, a sound removed, a sound added
    expect(countChanges(diffProject(before, after, k, k), words)).toBe(5)
  })

  it('fails if the version line does not say each change', () => {
    expect(describeChange(before, { music: after.music, sfx: after.sfx })).toBe(
      'music fades in over 1.2 s, music fades out over 0.5 s, added a sound effect, removed a sound effect, a sound effect at a new level'
    )
  })

  it("fails if What changed leaves out the fades or a sound's level", () => {
    expect(versionRows(before, after, { before: 30, after: 30 })).toEqual([
      { label: 'Music fade-in', before: '0.6 s', after: '1.2 s' },
      { label: 'Music fade-out', before: '1.5 s', after: '0.5 s' },
      { label: 'Whoosh level', before: '0 dB', after: '−6 dB' }
    ])
  })
})
