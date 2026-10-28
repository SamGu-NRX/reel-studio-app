// The Reel screen's playback speeds (components/transport.ts): what < and > step to, and what a saved speed reads
// back as when the app opens.
import { describe, expect, it } from 'vitest'
import { savedRate, stepRate } from '../src/renderer/src/components/transport'

describe('playback speed', () => {
  it('fails if > and < wrap round past the fastest or slowest speed instead of stopping there', () => {
    expect([0.5, 1, 1.5, 2].map((r) => stepRate(r, 1))).toEqual([1, 1.5, 2, 2])
    expect([0.5, 1, 1.5, 2].map((r) => stepRate(r, -1))).toEqual([0.5, 0.5, 1, 1.5])
  })

  it('fails if a saved half speed is not read back, or a speed we do not offer is', () => {
    expect(savedRate('0.5')).toBe(0.5)
    expect(savedRate('1.5')).toBe(1.5)
    for (const bad of [null, '', '3', '0', 'fast', '1.25']) expect(savedRate(bad)).toBe(1)
  })
})
