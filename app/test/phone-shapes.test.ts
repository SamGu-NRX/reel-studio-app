// The phone shapes the Reel screen's preview takes (shared/phone-shapes.ts): where the caption safe band (#59) is on
// each one. The whole reel must keep the engine's own band, and a phone's band must stay clear of every part of
// Instagram drawn on that phone, or the preview would tell someone a caption is safe when Instagram covers it.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MARGIN_FRAC } from '../src/shared/caption-fit'
import { SHAPES, chrome, clearBand, place, shapeById, type Rect } from '../src/shared/phone-shapes'

const verify = readFileSync(join(__dirname, '..', '..', 'engine', 'reelengine', 'verify.py'), 'utf8')
const frac = (name: string): number => Number(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, 'm').exec(verify)![1])

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

describe('phone shapes', () => {
  it("fails if the whole reel's safe band drifts from the edges the engine checks (verify.py, captions margin)", () => {
    const s = shapeById('reel')
    const band = clearBand(s)
    expect(band.x / s.w).toBeCloseTo(MARGIN_FRAC, 6)
    expect(1 - (band.x + band.w) / s.w).toBeCloseTo(frac('IG_RIGHT_FRAC'), 6)
    expect(band.y / s.h).toBeCloseTo(frac('IG_TOP_FRAC'), 6)
    expect(1 - (band.y + band.h) / s.h).toBeCloseTo(frac('IG_BOTTOM_FRAC'), 6)
  })

  for (const s of SHAPES.filter((x) => x.id !== 'reel')) {
    it(`fails if the ${s.label}'s safe band runs under Instagram's header, rail, name block or tab bar, or off the reel it shows`, () => {
      const band = clearBand(s)
      const { viewer, reel } = place(s)
      expect(band.w).toBeGreaterThan(0)
      expect(band.h).toBeGreaterThan(0)
      for (const [part, rect] of Object.entries(chrome(s))) expect({ part, overlaps: overlaps(band, rect) }).toEqual({ part, overlaps: false })
      // inside what Instagram shows of the reel, and no nearer its left edge than the engine's subtitle margin
      expect(band.x).toBeGreaterThanOrEqual(Math.max(viewer.x, reel.x + MARGIN_FRAC * reel.w) - 1e-9)
      expect(band.y).toBeGreaterThanOrEqual(viewer.y)
      expect(band.x + band.w).toBeLessThanOrEqual(viewer.x + viewer.w)
      expect(band.y + band.h).toBeLessThanOrEqual(viewer.y + viewer.h)
    })
  }

  it('fails if a 16:9 phone stops trimming the top and bottom, or a tall one the sides, or the whole reel anything', () => {
    const trim = (id: string) => place(shapeById(id)).trim
    expect(trim('reel')).toEqual({ sides: 0, ends: 0 })
    expect(trim('iphone-se').sides).toBe(0)
    expect(trim('iphone-se').ends).toBeGreaterThan(0.02)
    for (const id of ['iphone-17', 'iphone-pro-max']) {
      expect(trim(id).ends).toBe(0)
      expect(trim(id).sides).toBeGreaterThan(0.03)
    }
  })

  // fails if the shape menu writes a phone height first ("16:9"), which reads as a landscape phone, or names a
  // proportion the drawn screen doesn't have
  it("writes each shape's proportion width first, matching its screen", () => {
    for (const s of SHAPES) {
      const [w, h] = s.ratio.split(':').map(Number)
      expect(w, s.label).toBeLessThan(h)
      expect(w / h, s.label).toBeCloseTo(s.w / s.h, 2)
    }
  })
})
