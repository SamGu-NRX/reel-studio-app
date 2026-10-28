// The Windows title bar overlay (main/window.ts) is see-through, so the page and a modal's scrim show through it.
// Dimmed, it takes exactly the scrim's colour over the page.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { blendHex, INK, OVERLAY, PAPER, titleBarOverlay, WIN_TITLEBAR_HEIGHT } from '../src/main/window'

/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const c = [0, 1, 2].map((i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe('titleBarOverlay', () => {
  it('matches the page background, and the modal scrim over it while a modal is open', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles.css'), 'utf8')
    const m = /\.modal-backdrop\s*\{[^}]*background:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(css)
    if (!m) throw new Error('styles.css .modal-backdrop has no rgba() background')
    const scrim = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    expect(titleBarOverlay(false)).toEqual({ color: OVERLAY, symbolColor: INK, height: WIN_TITLEBAR_HEIGHT })
    expect(titleBarOverlay(true).color).toBe(blendHex(PAPER, scrim, Number(m[4])))
  })

  // Windows and Linux draw the window buttons themselves in symbolColor, over the page. On the full-screen stage the
  // page behind them is the stage's near-black --bezel, so dark symbols there are invisible (measured on Windows 11).
  it('on the full-screen stage, the window buttons stand out from the stage (WCAG contrast of at least 4.5)', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/src/styles.css'), 'utf8')
    const m = /--bezel:\s*(#[0-9a-fA-F]{6})/.exec(css)
    if (!m) throw new Error('styles.css has no --bezel colour')
    const stage = titleBarOverlay(false, true)
    expect(stage.color).toBe(OVERLAY) // still see-through: the stage shows behind the buttons
    expect(contrast(stage.symbolColor, m[1])).toBeGreaterThanOrEqual(4.5)
    // and back on the page, the usual dark symbols on paper
    expect(contrast(titleBarOverlay(false).symbolColor, PAPER)).toBeGreaterThanOrEqual(4.5)
  })

  it('blends per channel and rounds', () => {
    expect(blendHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(blendHex('#f7f5f1', '#1d1b18', 0)).toBe('#f7f5f1')
    expect(blendHex('#f7f5f1', '#1d1b18', 1)).toBe('#1d1b18')
  })
})
