// Windows high contrast (CSS forced colours) paints every background in the window colour. The timeline draws its rail,
// the part already played and the playhead as backgrounds, so there they vanished, the rest of the screen still drawn.
// Chromium's forced-colours emulation renders with the same palette rules, so the test runs it on every platform.
import { test, expect } from '@playwright/test'
import { launch, makeMedia, makeReel, painted, passFirstRun } from './helpers'

/** WCAG contrast ratio of two sRGB colours. */
function contrast(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

test('fails if the timeline rail, what has played or the playhead disappears in Windows high contrast', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch()
  try {
    await passFirstRun(page)
    await makeReel(page, media.video, 10 * 60_000)
    await page.evaluate(() => {
      const v = document.querySelector('[data-testid=player]') as HTMLVideoElement
      v.pause()
      v.currentTime = v.duration / 2
    })
    await page.emulateMedia({ forcedColors: 'active' })
    await page.waitForTimeout(300)
    const at = await page.evaluate(() => {
      const rail = document.querySelector('.tl-rail')!.getBoundingClientRect()
      const knob = document.querySelector('.tl-head i')!.getBoundingClientRect()
      const y = Math.round(rail.top + rail.height / 2)
      const kx = Math.round(knob.left + knob.width / 2)
      // the background beside each: 10 px under the rail, where nothing of the timeline is drawn without music
      return { unplayed: [Math.round(rail.right - 4), y], played: [kx - 16, y], knob: [kx, y], y: y + 10 }
    })
    for (const [what, [x, y]] of Object.entries({ unplayed: at.unplayed, played: at.played, playhead: at.knob })) {
      const drawn = await painted(page, x, y)
      const behind = await painted(page, x, at.y)
      expect.soft(contrast(drawn, behind), `${what} at ${x},${y}: ${drawn} on ${behind}`).toBeGreaterThanOrEqual(3)
    }
  } finally {
    await app.close()
  }
})
