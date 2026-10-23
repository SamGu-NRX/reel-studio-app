// An Edit it myself change kept as what changed (shared/hand-edit.ts), so it can wait behind a note and land on
// whatever the note left. Each case below has one right answer.
import { describe, expect, it } from 'vitest'
import type { ProjectJson, Word } from '../src/shared/api'
import { keptIds } from '../src/shared/cut'
import { applyHandEdit, countChanges, diffProject, parseHandEdit } from '../src/shared/hand-edit'

const words: Word[] = ['so', 'my', 'cat', 'Biscuit', 'sits', 'here', 'then', 'fold'].map((w, i) => ({ id: `w${i + 1}`, w, s: i, e: i + 0.8 }))
const ids = (from: number, to: number) => words.slice(from - 1, to).map((w) => w.id)

function project(extra: Partial<ProjectJson> = {}): ProjectJson {
  return {
    schemaVersion: 1, id: 'p', title: 't', slug: 't', createdAt: '', updatedAt: '', version: 1,
    sources: [{ id: 's1', path: 'raw.mov' }],
    cut: { keep: [{ from: 'w1', to: 'w8' }] },
    captions: { enabled: true, style: { size: 105, position: 0.75 } },
    cover: { atSourceTime: 1, source: 's1', text: null },
    broll: [{ id: 'b1', anchor: { from: 'w3', to: 'w4' }, treatment: 'card-above-head', asset: 'Library/Images/cat.jpg' }],
    ...extra
  }
}
const kept = (p: ProjectJson) => new Set(keptIds(words, p.cut?.keep))

describe('hand edits', () => {
  it('fails if an edit made on Version 1 undoes what a note changed in Version 2', () => {
    const v1 = project()
    const edited = { ...v1, captions: { enabled: true, style: { size: 105, position: 0.66 } } }
    const edit = diffProject(v1, edited, kept(v1), kept(v1))
    // the note made the subtitles bigger and added a picture meanwhile
    const v2 = project({
      version: 2,
      captions: { enabled: true, style: { size: 126, position: 0.75 } },
      broll: [...v1.broll!, { id: 'b2', anchor: { from: 'w6', to: 'w6' }, treatment: 'full-frame', asset: null }]
    })
    const out = applyHandEdit(v2, edit, words)
    expect(out.captions?.style).toEqual({ size: 126, position: 0.66 })
    expect(out.broll?.map((b) => b.id)).toEqual(['b1', 'b2'])
    expect(out.version).toBe(2)
  })

  it('fails if cutting words drops what a note cut, or brings back words the edit never touched', () => {
    const v1 = project()
    const after = kept(v1)
    for (const id of ids(2, 4)) after.delete(id) // "my cat Biscuit"
    const edit = diffProject(v1, v1, kept(v1), after)
    const v2 = project({ cut: { keep: [{ from: 'w1', to: 'w6' }] } }) // the note cut "then fold"
    expect(keptIds(words, applyHandEdit(v2, edit, words).cut?.keep)).toEqual(['w1', 'w5', 'w6'])
  })

  it('fails if a sound, a picture taken out, or a flip is lost or doubled when the edit is applied twice', () => {
    const v1 = project()
    const edited: ProjectJson = {
      ...v1,
      broll: [],
      sfx: [{ at: { word: 'w3' }, sound: 'whoosh-quick', gainDb: -8 }],
      sources: [{ id: 's1', path: 'raw.mov', mirror: true }]
    }
    const edit = diffProject(v1, edited, kept(v1), kept(v1))
    const once = applyHandEdit(v1, edit, words)
    expect(applyHandEdit(once, edit, words)).toEqual(once)
    expect(once.broll).toBeUndefined()
    expect(once.sfx).toEqual([{ at: { word: 'w3' }, sound: 'whoosh-quick', gainDb: -8 }])
    expect(once.sources).toEqual([{ id: 's1', path: 'raw.mov', mirror: true }])
  })

  it('fails if a changed sound is added beside the old one instead of replacing it', () => {
    const v1 = project({ sfx: [{ at: { word: 'w3' }, sound: 'whoosh-quick' }] })
    const edited = { ...v1, sfx: [{ at: { word: 'w3' }, sound: 'pop-soft', gainDb: 6 }] }
    const out = applyHandEdit(v1, diffProject(v1, edited, kept(v1), kept(v1)), words)
    expect(out.sfx).toEqual([{ at: { word: 'w3' }, sound: 'pop-soft', gainDb: 6 }])
  })

  it('fails if main would apply anything but the parts Edit it myself changes', () => {
    const empty = { items: [], words: { cut: [], keep: [] }, mirror: [] }
    for (const path of [['title'], ['version'], ['sources', 's1', 'path'], ['captions', '__proto__', 'x'], ['captions', 'split']]) {
      expect(() => parseHandEdit({ ...empty, set: [{ path, value: 1 }] })).toThrow()
    }
    expect(() => parseHandEdit({ set: [], items: [{ list: 'broll', key: 'b9', item: { id: 'b1' } }], words: { cut: [], keep: [] }, mirror: [] })).toThrow()
    expect(parseHandEdit({ ...empty, set: [{ path: ['cover', 'text'], value: 'Hi' }] }).set).toEqual([{ path: ['cover', 'text'], value: 'Hi' }])
  })

  it('fails if "2 changes" counts each word of one cut, or each frame value of one new cover', () => {
    const v1 = project()
    const after = kept(v1)
    for (const id of ids(2, 4)) after.delete(id)
    const edited = { ...v1, cover: { atSourceTime: 4, source: 's1', text: null, exact: null, manual: true } }
    expect(countChanges(diffProject(v1, edited, kept(v1), after), words)).toBe(2)
  })

  it('fails if a style the project did not have yet replaces, whole, the style a note gave it meanwhile', () => {
    const v1 = project({ captions: { enabled: true } })
    const edit = diffProject(v1, { ...v1, captions: { enabled: true, style: { size: 126 } } }, kept(v1), kept(v1))
    const v2 = project({ version: 2, captions: { enabled: true, style: { position: 0.66, color: '#FFD60A' } } })
    expect(applyHandEdit(v2, edit, words).captions?.style).toEqual({ position: 0.66, color: '#FFD60A', size: 126 })
  })
})
