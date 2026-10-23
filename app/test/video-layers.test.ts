import { describe, expect, it } from 'vitest'
import { NO_LAYERS, layersReducer, versionOnScreen, versionsShown, type LayerEvent, type Layers } from '../src/renderer/src/components/videoLayers'

const run = (...events: LayerEvent[]): Layers => events.reduce(layersReducer, NO_LAYERS)
const want = (src: string): LayerEvent => ({ type: 'want', src, poster: null })

describe('player source switching', () => {
  it('a late load from an earlier switch never replaces a newer source', () => {
    const s = run(want('v1'), want('v2'), want('v3'), { type: 'ready', id: 2 })
    expect(s.shown?.src).toBe('v1')
    expect(s.next?.src).toBe('v3')
    expect(run(want('v1'), want('v2'), want('v3'), { type: 'ready', id: 2 }, { type: 'ready', id: 3 }).shown?.src).toBe('v3')
  })

  it('a picked video that will not play is dropped, and the one on screen stays', () => {
    const s = run(want('v1'), want('v2'), { type: 'failed', id: 2 }, { type: 'ready', id: 2 })
    expect([s.shown?.src, s.next, s.leaving]).toEqual(['v1', null, null])
  })

  it('while a picked version loads, the marks, change pop-up and original read the version still on screen', () => {
    const versions = [
      { n: 1, video: 'v1' },
      { n: 2, video: 'v2' }
    ]
    const picked2 = run(want('v1'), want('v2'))
    expect(versionOnScreen(versions, picked2.shown?.src ?? null)?.n).toBe(1)
    expect(versionOnScreen(versions, layersReducer(picked2, { type: 'ready', id: 2 }).shown?.src ?? null)?.n).toBe(2)
  })
})

describe('versionsShown', () => {
  const preview = { n: 0, draft: true }
  const reel = (status: string, kind: string | null) => ({ status, job: kind ? { kind } : null, versions: [preview] })
  // a reel whose only version is a preview, with a job running on it: the Reel screen must keep its version
  it('fails if a note, a hand edit or an export on a preview-only reel hides the preview', () => {
    for (const kind of ['note', 'rerender', 'export']) expect([kind, versionsShown(reel('interrupted', kind))]).toEqual([kind, [preview]])
    expect(versionsShown(reel('ready', null))).toEqual([preview])
  })
  it('fails if a preview shows as a version while the first edit runs or has not finished', () => {
    expect(versionsShown(reel('working', 'first-edit'))).toEqual([])
    for (const status of ['new', 'failed', 'interrupted']) expect([status, versionsShown(reel(status, null))]).toEqual([status, []])
  })
})

