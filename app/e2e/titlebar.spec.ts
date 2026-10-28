// Windows and Linux draw the window buttons over the page, in a title-bar strip the app leaves see-through
// (main/window.ts OVERLAY), so what the page paints under the buttons is what shows there. A modal's scrim has to reach
// under them too, or the strip stays bright above a dimmed window.
import { test, expect } from '@playwright/test'
import { launch, makeMedia, makeReel, painted, passFirstRun } from './helpers'

test('fails if the title bar strip stays undimmed while a modal is open', async () => {
  test.skip(process.platform === 'darwin', 'macOS draws traffic lights over the page, not an overlay strip.')
  const media = makeMedia()
  const { app, page } = await launch()
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)
    // a point under the window buttons: right of the title-bar area the page keeps for itself
    const under = await page.evaluate(() => {
      // not in this TypeScript's DOM types yet
      const wco = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay
      if (!wco?.visible) throw new Error('the window buttons are not drawn over the page (no window controls overlay)')
      const r = wco.getTitlebarAreaRect()
      return { x: Math.round((r.right + innerWidth) / 2), y: Math.round(r.top + r.height / 2) }
    })
    const near = (got: number[], want: number[]) => got.every((c, i) => Math.abs(c - want[i]) <= 2)
    const open = await painted(page, under.x, under.y)

    await page.getByTestId('more').click()
    await page.getByTestId('delete').click()
    await expect(page.getByTestId('confirm')).toContainText('Delete this reel?')
    const scrim = await page.evaluate(({ x, y }) => {
      const backdrop = document.elementFromPoint(x, y)?.closest('.modal-backdrop')
      return backdrop ? getComputedStyle(backdrop).backgroundColor : null
    }, under)
    expect(scrim, 'the modal backdrop reaches under the window buttons').not.toBeNull()
    const [r, g, b, a] = scrim!.match(/[\d.]+/g)!.map(Number)
    const dimmed = open.map((c, i) => Math.round(c * (1 - a) + [r, g, b][i] * a))
    await expect.poll(() => painted(page, under.x, under.y).then((c) => near(c, dimmed)), { message: `dimmed to ${dimmed}` }).toBe(true)

    await page.getByTestId('confirm-no').click()
    await expect(page.getByTestId('confirm')).toHaveCount(0)
    await expect.poll(() => painted(page, under.x, under.y).then((c) => near(c, open)), { message: `back to ${open}` }).toBe(true)
  } finally {
    await app.close()
  }
})
