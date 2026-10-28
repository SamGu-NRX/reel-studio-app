// The subtitle looks in "Edit it myself": a Size the person picked survives every look, Karaoke shows both
// colour rows, colours the AI editor picked that match no option leave the rows unchecked but reachable by Tab, and
// each look's word fits its strip at the smallest window.
//
// Run: npx playwright test e2e/caption-looks.spec.ts (after npm run build). Same env as smoke.spec.ts.
import { test, expect } from '@playwright/test'
import { launch, makeMedia, makeReel, passFirstRun, shot } from './helpers'

test('caption looks: size through look switches, Karaoke rows, colours that match no option', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch()
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)

    // A reel the AI editor gave red captions and a green spoken word (#34C759, not the row's #30D158). First, since
    // Edit it myself keeps its changes when it closes and would show those instead.
    const detail = await page.evaluate(async () => {
      const [p] = await window.reel.projects.list()
      return window.reel.projects.get(p.slug)
    })
    const styled = {
      ...detail,
      project: { ...detail.project, captions: { ...detail.project.captions, enabled: true, style: { ...detail.project.captions?.style, color: '#FF3B30', highlight: '#34C759' } } }
    }
    await app.evaluate(({ ipcMain }, d) => {
      ipcMain.removeHandler('projects:get')
      ipcMain.handle('projects:get', () => ({ ok: true, value: d }))
    }, styled)
    await page.getByTestId('nav-home').click()
    await page.getByTestId('project-card').click()
    await page.getByTestId('edit-myself').click()
    await page.getByTestId('tab-captions').click()
    for (const id of ['cap-color-white', 'cap-color-yellow', 'cap-highlight-yellow', 'cap-highlight-green'])
      await expect(page.getByTestId(id)).toHaveAttribute('aria-checked', 'false')
    await page.getByTestId('cap-pos-lower').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('cap-color-white')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('cap-highlight-yellow')).toBeFocused()
    await shot(page, 'looks-unmatched-colours')

    // a Size the person picked survives every look; Karaoke shows both colour rows
    await page.getByTestId('cap-size-big').click()
    await page.getByTestId('cap-look-bold-pop').click()
    await expect(page.getByTestId('cap-size-big')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('cap-look-minimal').click()
    await expect(page.getByTestId('cap-look-minimal')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('cap-size-big')).toHaveAttribute('aria-checked', 'true')

    await page.getByTestId('cap-size-medium').click()
    await page.getByTestId('cap-look-karaoke').click()
    await expect(page.getByTestId('cap-color-white')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('cap-highlight-yellow')).toHaveAttribute('aria-checked', 'true')
    await shot(page, 'looks-karaoke-rows')

    // fails if a look's word is cut off by its strip at the smallest window (Bold pop's ran off its tile at 1100)
    await page.setViewportSize({ width: 1100, height: 720 })
    const strips = page.locator('.look-strip')
    await expect(strips).toHaveCount(5)
    for (const strip of await strips.all()) {
      const inside = await strip.evaluate((el) => {
        const s = el.getBoundingClientRect()
        const w = el.querySelector('.sub-sample')!.getBoundingClientRect()
        return w.left >= s.left && w.right <= s.right && w.top >= s.top && w.bottom <= s.bottom
      })
      expect(inside).toBe(true)
    }
  } finally {
    await app.close()
  }
})
