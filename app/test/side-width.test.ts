import { describe, expect, it } from 'vitest'
import { sideWidth } from '../src/renderer/src/components/side-width'

describe('sidebar width', () => {
  it('never goes under 232 px, where the "Reel Studio" wordmark starts to clip (finding 9)', () => {
    expect(sideWidth(100)).toBe(232)
    expect(sideWidth('231.6')).toBe(232)
    expect(sideWidth(9999)).toBe(360)
    expect(sideWidth(300.4)).toBe(300)
  })

  it('falls back to 248 px for a stored value that is missing or not a number, instead of collapsing the sidebar', () => {
    expect(sideWidth(null)).toBe(248)
    expect(sideWidth('')).toBe(248)
    expect(sideWidth('wide')).toBe(248)
  })
})
