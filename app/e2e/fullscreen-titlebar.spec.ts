// Windows and Linux draw the window buttons (minimise, maximise, close) themselves, over the page, in the title bar
// overlay's symbolColor. On the full-screen stage that page is near-black, so the dark symbols vanish (Windows 11:
// glyphs within 5 of the stage's luminance). Opening the stage must turn them white, and closing it must put them back.
import { test, expect } from '@playwright/test'
import { launch, makeMedia, makeReel, passFirstRun } from './helpers'

test('fails if the window buttons stay dark on the full-screen stage, or stay white after it closes', async () => {
  test.skip(process.platform === 'darwin', 'macOS draws its own traffic lights, not overlay symbols.')
  test.setTimeout(10 * 60_000)
  const { app, page } = await launch()
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      const set = w.setTitleBarOverlay.bind(w)
      const g = globalThis as { __symbols?: string[] }
      g.__symbols = []
      w.setTitleBarOverlay = (o) => {
        g.__symbols!.push(String(o.symbolColor).toUpperCase())
        set(o)
      }
    })
    const symbols = () => app.evaluate(() => (globalThis as { __symbols?: string[] }).__symbols ?? [])
    await passFirstRun(page)
    await makeReel(page, makeMedia().video)
    const before = (await symbols()).length
    await page.getByTestId('full-screen').click()
    await expect(page.getByTestId('full-stage')).toBeVisible()
    await expect.poll(async () => (await symbols()).slice(before).at(-1)).toBe('#FFFFFF')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('full-stage')).toHaveCount(0)
    await expect.poll(async () => (await symbols()).slice(before).at(-1)).toBe('#161917')
  } finally {
    await app.close()
  }
})
