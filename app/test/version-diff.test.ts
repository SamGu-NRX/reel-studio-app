import { describe, expect, it } from 'vitest'
import type { ProjectJson } from '../src/shared/api'
import { versionRows } from '../src/shared/version-diff'

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
