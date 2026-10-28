import { describe, expect, it } from 'vitest'
import type { ProjectJson } from '../src/shared/api'
import { versionFact, versionRows } from '../src/shared/version-diff'

const base = (patch: Partial<ProjectJson> = {}): ProjectJson =>
  ({
    schemaVersion: 1, id: 'p', title: 'T', slug: 't', createdAt: '', updatedAt: '', version: 1,
    sources: [{ id: 's1', path: 'media/s1.mov', duration: 192 }],
    captions: { enabled: true, style: { size: 105, position: 0.75 } },
    music: { enabled: false, track: null },
    broll: [], zooms: [],
    cover: { atSourceTime: 5, source: 's1', text: null },
    ...patch
  }) as ProjectJson

describe('versionRows', () => {
  it('names only what a change touched, before and after', () => {
    const before = base()
    const after = base({ captions: { enabled: true, style: { size: 126, position: 0.75 } }, music: { enabled: true, track: 'Library/Music/Warm Rise.mp3' } })
    expect(versionRows(before, after, { before: 30, after: 30 })).toEqual([
      { label: 'Subtitle size', before: 'Medium', after: 'Big' },
      { label: 'Music', before: 'None', after: '“Warm Rise”' }
    ])
  })

  it('compares the first version with the raw video', () => {
    expect(versionRows(null, base({ broll: [{ id: 'b1', anchor: { from: 'w1', to: 'w2' }, treatment: 'full', asset: 'x.jpg' }] }), { before: 192, after: 30 })).toEqual([
      { label: 'Length', before: '3:12', after: '0:30' },
      { label: 'Subtitles', before: 'None', after: 'On' },
      { label: 'Pictures', before: 'None', after: '1 picture' },
      { label: 'Cover', before: 'None', after: 'The 0:05 frame' }
    ])
  })
})

describe('versionFact', () => {
  const picture = { id: 'b1', anchor: { from: 'w1', to: 'w2' }, treatment: 'card-above-head', asset: 'x' } as NonNullable<ProjectJson['broll']>[number]
  const sound = { sound: 'whoosh-soft', at: { word: 'w3' } }

  // fails if a version's line is the clamped "Version 2: new song …" sentence instead of a short fact from its rows
  it('says in a few words what the rows changed', () => {
    const after = base({ music: { enabled: true, track: 'Library/Music/warm acoustic loop.mp3' }, broll: [picture], sfx: [sound] })
    expect(versionFact(versionRows(base(), after, { before: 20, after: 20 }))).toBe('Song, 1 sound effect, 1 picture')
    const swapped = base({ music: { enabled: true, track: 'Library/Music/sunny day.mp3' } })
    expect(versionFact(versionRows(after, swapped, { before: 20, after: 20 }))).toBe('New song, no sound effects, no pictures')
  })

  it('reads a subtitle’s size and look as one change, and a move alone as where they went', () => {
    const bigYellow = base({ captions: { enabled: true, style: { size: 126, position: 0.6, color: '#FFD60A' } } })
    expect(versionFact(versionRows(base(), bigYellow, { before: 20, after: 20 }))).toBe('Bigger yellow subtitles')
    const higher = base({ captions: { enabled: true, style: { size: 105, position: 0.6 } } })
    expect(versionFact(versionRows(base(), higher, { before: 20, after: 18 }))).toBe('Shorter, higher subtitles')
  })

  it('says what Version 1 did to the raw video, and names three before "and N more"', () => {
    const v1 = base({ cover: { atSourceTime: 3, source: 's1', text: null } })
    expect(versionFact(versionRows(null, v1, { before: 21, after: 20 }))).toBe('Shorter, subtitles, cover')
    const lots = base({ captions: { enabled: true, style: { size: 126, position: 0.75 } }, music: { enabled: true, track: 'Library/Music/a.mp3' }, broll: [picture], sfx: [sound], cover: { atSourceTime: 9, source: 's1', text: 'Hi' } })
    expect(versionFact(versionRows(base(), lots, { before: 30, after: 20 }))).toBe('Shorter, bigger subtitles, song and 4 more')
    expect(versionFact([])).toBe('')
  })
})
