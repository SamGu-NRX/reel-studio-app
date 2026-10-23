// The Reel screen's phone (components/Phone.tsx): Instagram view by default, Clean on request, the choice kept in
// the app's settings, the phone at 9:16 filling its column's height at the three window sizes the spec names, and
// the safe zone only while the subtitles are being set up, and full screen still closing with Instagram's looping
// audio ticker inside it. The window's own full screen is stubbed: fullscreen.spec covers it.
//
// Run: npx playwright test e2e/phone-view.spec.ts (after npm run build).
import { test, expect, type Page } from '@playwright/test'
import { launch, makeMedia, makeReel, passFirstRun } from './helpers'

const SIZES = [
  { width: 1100, height: 720 },
  { width: 1280, height: 820 },
  { width: 1512, height: 945 }
]

/** The phone's screen, its slot, and how far the stage's last row (the transport) reaches. */
const layout = (page: Page) =>
  page.evaluate(() => {
    const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
    const stage = document.querySelector('.stage')!
    return { screen: r('.stage .phone-screen'), slot: r('.stage .phone-fill'), bottom: stage.lastElementChild!.getBoundingClientRect().bottom, view: innerHeight, scrollW: document.documentElement.scrollWidth, w: innerWidth }
  })

test('fails if the phone stops filling its column at 9:16, the view is not Instagram first and remembered, or full screen cannot close', async () => {
  test.setTimeout(6 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch()
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('app:fullScreen')
    ipcMain.handle('app:fullScreen', () => undefined)
  })
  try {
    await passFirstRun(page)
    await makeReel(page, media.video, 5 * 60_000)

    for (const size of SIZES) {
      await page.setViewportSize(size)
      await expect
        .poll(async () => {
          const l = await layout(page)
          return [
            Math.abs(l.screen.width / l.screen.height - 9 / 16) < 0.005,
            Math.abs(l.screen.height - l.slot.height) <= 1,
            l.bottom <= l.view,
            l.scrollW <= l.w
          ]
        }, { message: `phone at ${size.width}x${size.height}: 9:16, full slot height, stage inside the window, no sideways scroll` })
        .toEqual([true, true, true, true])
    }

    // Instagram first: its screen is drawn; speed sits in the transport row under the video in either view.
    await expect(page.getByTestId('ig-overlay')).toBeVisible()
    await expect(page.getByTestId('speed')).toBeVisible()

    await page.getByTestId('view-clean').click()
    await expect(page.getByTestId('ig-overlay')).toBeHidden()
    await expect(page.getByTestId('view-clean')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => page.evaluate(() => window.reel.app.info().then((i) => i.phoneView))).toBe('clean')
    await expect(page.getByTestId('speed')).toBeVisible()

    // kept across a restart of the page, from the app's settings
    await page.reload()
    await page.getByTestId('project-card').first().click()
    await expect(page.getByTestId('player')).toBeVisible()
    await expect(page.getByTestId('view-clean')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('ig-overlay')).toBeHidden()

    // the safe zone shows while the subtitles are being set up, and only then
    await page.getByTestId('view-instagram').click()
    await expect(page.getByTestId('ig-overlay')).toBeVisible()
    await expect(page.getByTestId('safe-band')).toHaveCount(0)
    await page.getByTestId('edit-myself').click()
    await page.getByTestId('tab-captions').click()
    await expect(page.getByTestId('safe-band')).toBeVisible()
    await page.getByTestId('tab-cut').click()
    await expect(page.getByTestId('safe-band')).toHaveCount(0)
    await page.keyboard.press('Escape')
  } finally {
    await app.close()
  }
})
