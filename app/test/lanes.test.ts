import { describe, expect, it } from 'vitest'
import type { ProjectJson, Word } from '../src/shared/api'
import { laneLayout, lanesOf, pictureParts, pictureWhy, type Broll, type LayerItem } from '../src/shared/lanes'
import { placeWords, type RenderSegment } from '../src/shared/moments'

// Video 1 (s1) says w0..w9, one every 0.5 s. The cut keeps w0-w3 (the render trims the pause inside it), then plays
// a clip of video 2 (s2) whole, then keeps w6-w9.
const words: Word[] = Array.from({ length: 10 }, (_, i) => ({ id: `w${i}`, w: ['so', 'flour', 'water', 'salt', 'um', 'uh', 'then', 'fold', 'it', 'twice'][i], s: i * 0.5, e: i * 0.5 + 0.3, source: 's1' }))
const segments: RenderSegment[] = [
  { source: 's1', src_start: 0, src_end: 0.85, out_start: 0 },
  { source: 's1', src_start: 0.95, src_end: 1.85, out_start: 0.85 },
  // the clip's ends, snapped to its video's frames by the engine
  { source: 's2', src_start: 10, src_end: 14, out_start: 1.75 },
  { source: 's1', src_start: 2.95, src_end: 4.85, out_start: 5.75 }
]
const placed = placeWords(segments, words)
const kept = new Set(['w0', 'w1', 'w2', 'w3', 'w6', 'w7', 'w8', 'w9'])
const project: Pick<ProjectJson, 'broll' | 'sfx' | 'music' | 'cut' | 'sources'> = {
  sources: [
    { id: 's1', path: 'media/me.mp4' },
    { id: 's2', path: 'media/kitchen.mp4' }
  ],
  cut: { keep: [{ from: 'w0', to: 'w3' }, { clip: 'c1', source: 's2', in: 10.02, out: 13.98 } as never, { from: 'w6', to: 'w9' }] }
}
const round = (n: number) => Math.round(n * 1000) / 1000
const pic = (id: string, from: string, to: string, treatment: string, asset: string | null, params: Record<string, unknown> = {}): Broll => ({ id, anchor: { from, to }, treatment, asset, params })

describe('timeline lanes', () => {
  it('fails if a clip from another video is drawn as speech, or a trimmed pause splits a kept range in two', () => {
    const l = lanesOf(project, { placed, segments, words, kept, duration: 7.65, layers: new Map() }, new Map())
    expect(l.video.map((p) => [p.kind, round(p.t0), round(p.t1), p.video, p.said])).toEqual([
      ['speech', 0, 1.75, 1, 'so flour water salt'],
      ['clip', 1.75, 5.75, 2, ''],
      ['speech', 5.75, 7.65, 1, 'then fold it twice']
    ])
    // the same cut with no clip between: two kept ranges, two parts
    const plain = segments.filter((s) => s.source === 's1').map((s) => (s.out_start === 5.75 ? { ...s, out_start: 1.75 } : s))
    const cut = lanesOf({ ...project, cut: { keep: [{ from: 'w0', to: 'w3' }, { from: 'w6', to: 'w9' }] } }, { placed: placeWords(plain, words), segments: plain, words, kept, duration: 3.65, layers: new Map() }, new Map())
    expect(cut.video.map((p) => [p.kind, round(p.t0), round(p.t1)])).toEqual([
      ['speech', 0, 1.75],
      ['speech', 1.75, 3.65]
    ])
  })

  it('fails if a picture is not shown when the engine shows it: its lead-in, its hold, the hand-off to the next one', () => {
    const broll = [
      pic('b1', 'w0', 'w1', 'card-above-head', 'Library/Images/cup.png'),
      pic('b2', 'w3', 'w3', 'text-pop', null, { text: 'salt' }),
      pic('b3', 'w6', 'w9', 'phone-card', 'Library/Videos/pour.mp4'),
      // its word is cut: not in this version
      pic('b4', 'w4', 'w4', 'card-above-head', 'Library/Images/um.png'),
      // placed by source time, inside the clip
      { id: 'b5', anchor: { source: 's2', s: 11, e: 12 } as never, treatment: 'full-frame', asset: 'Library/Images/map.jpg', params: {} }
    ]
    const parts = pictureParts(broll, { placed, segments }, new Map(), 7.65)
    expect(parts.map((p) => [p.id, round(p.t0), round(p.t1), p.what, p.line])).toEqual([
      // a still holds 2 s, but hands off where the words on "salt" come in, 0.13 s before them
      ['b1', 0, 1.27, 'Picture above your head', 'so flour'],
      ['b2', 1.27, 2.62, 'Words on screen: “salt”', 'salt'],
      ['b5', 2.62, 4.62, 'Picture filling the screen', ''],
      // a video holds 0.6 s; this one lasts its words, to the end of the reel
      ['b3', 5.67, 7.65, 'Clip in a phone', 'then fold it twice']
    ])
  })

  it('fails if a gap shorter than the engine flashes (0.22 s) is drawn between two pictures', () => {
    const parts = pictureParts([pic('x1', 'w0', 'w0', 'text-pop', null, { text: 'so', hold: 0.6 }), pic('x2', 'w2', 'w2', 'text-pop', null, { text: 'water' })], { placed, segments }, new Map(), 7.65)
    expect(parts.map((p) => [p.id, round(p.t0), round(p.t1)])).toEqual([
      ['x1', 0, 0.77],
      ['x2', 0.77, 2.77]
    ])
  })

  it("fails if the render's own times are not what the lane shows, or a picture it left out looks like one it showed", () => {
    const layers = new Map<string, LayerItem>([
      ['b1', { id: 'b1', t0: 0.05, t1: 1.2 }],
      ['b2', { id: 'b2', t0: 1.2, t1: 3.1 }],
      ['b3', { id: 'b3', skipped: "This b-roll file isn't a picture or a video." }]
    ])
    const broll = [pic('b1', 'w0', 'w1', 'card-above-head', 'a.png'), pic('b2', 'w3', 'w3', 'side-card', 'b.png'), pic('b3', 'w6', 'w9', 'phone-card', 'c.txt')]
    const parts = pictureParts(broll, { placed, segments }, layers, 7.65)
    expect(parts.map((p) => [p.id, round(p.t0), round(p.t1), p.skipped])).toEqual([
      ['b1', 0.05, 1.2, null],
      ['b2', 1.2, 3.1, null],
      ['b3', 5.67, 7.65, "This b-roll file isn't a picture or a video."]
    ])
  })

  it('fails if a picture says the wrong reason for being there', () => {
    const versions = [
      { n: 1, facts: [{ kind: 'broll', id: 'b1', before: null, after: {} }] },
      { n: 2, facts: [{ kind: 'broll', id: 'b2', before: null, after: {} }] },
      { n: 3, facts: [{ kind: 'broll', id: 'b2', before: {}, after: {} }] }
    ]
    const notes = [{ version: 2, text: 'show the route map when I talk about the drive' }]
    expect(pictureWhy('b1', versions, notes, 3)).toBe('Added when Version 1 was made')
    // changed in Version 3, added in Version 2: the note that added it
    expect(pictureWhy('b2', versions, notes, 3)).toBe('Added for “show the route map when I talk about the drive”, Version 2')
    // Version 1 on screen: Version 2's note is not why it is there yet
    expect(pictureWhy('b2', versions, notes, 1)).toBeNull()
  })

  it("fails if a picture's reason shows the word ids project.json saved with its note", () => {
    const versions = [{ n: 2, facts: [{ kind: 'broll', id: 'b2', before: null, after: {} }] }]
    const notes = [{ version: 2, text: 'At 0:06 (around "the drive", words w10, w11): show the route map here' }]
    expect(pictureWhy('b2', versions, notes, 2)).toBe('Added for “show the route map here”, Version 2')
  })
})

describe('lane layout', () => {
  it('fails if back-to-back pictures merge into one bar, or a short one is too thin to see', () => {
    const [a, b, c] = laneLayout(
      [
        { t0: 10, t1: 20 },
        { t0: 20, t1: 30 },
        { t0: 50, t1: 50.05 }
      ],
      100,
      1000
    )
    expect(b.x - (a.x + a.w)).toBe(2)
    expect(c.w).toBe(3)
    // room on both sides: a full 24 px target around its bar
    expect(c.hitW).toBe(24)
  })

  it('fails if a picture too narrow for its thumbnail gets one, or one wide enough goes without', () => {
    // 19 px, 20 px, and a 2 px picture widened to 3 px
    const bars = laneLayout(
      [
        { t0: 0, t1: 1.9 },
        { t0: 10, t1: 12 },
        { t0: 20, t1: 20.2 }
      ],
      100,
      1000
    )
    expect(bars.map((b) => [b.w, b.thumb])).toEqual([
      [19, false],
      [20, true],
      [3, false]
    ])
  })

  it('fails if two pictures on a long reel share a pointer target, or one has none', () => {
    // 40 pictures on a three-minute reel, on the narrowest stage the window allows
    const parts = Array.from({ length: 40 }, (_, i) => ({ t0: i * 4.4, t1: i * 4.4 + (i % 3 === 0 ? 0.3 : 2) }))
    const bars = laneLayout(parts, 180, 428)
    expect(bars).toHaveLength(40)
    for (const [i, b] of bars.entries()) {
      expect(b.w).toBeGreaterThanOrEqual(3)
      expect(b.hitW).toBeGreaterThan(0)
      // over its own bar, whatever else it gives up
      expect(b.hitX).toBeLessThanOrEqual(b.x + b.w / 2)
      expect(b.hitX + b.hitW).toBeGreaterThanOrEqual(b.x + b.w / 2)
      if (i) expect(b.hitX).toBeGreaterThanOrEqual(bars[i - 1].hitX + bars[i - 1].hitW - 1e-9)
    }
  })
})
