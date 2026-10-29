import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launch, makeMedia, makeReel, passFirstRun } from './helpers'

const SIZES: [number, number][] = [
  [1100, 720],
  [1280, 820],
  [1512, 982],
  [1920, 1080]
]

async function setSize(app: ElectronApplication, page: Page, [w, h]: [number, number]): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setContentSize(s.w, s.h), { w, h })
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([w, h])
}

const box = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
  })

// BRIEF layout rule 1: at 1920x1080 play and the time sat in the stage's left corner and the view switch in its right,
// 700 px from a 530 px phone; once under it, the shape pill was cut to "W…".
test('fails if the play controls and timeline are not centred under the phone, or a control in their row is cut short', async () => {
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_MOCK_CLAUDE: 'ready' }, { realViewport: true })
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)
    for (const size of SIZES) {
      await setSize(app, page, size)
      const at = `${size[0]}x${size[1]}`
      await expect.poll(async () => {
        const phone = await box(page, '.stage-v .phone')
        const row = await box(page, '.stage > .transport')
        return Math.abs((row.left + row.right) / 2 - (phone.left + phone.right) / 2)
      }, { message: at }).toBeLessThan(2)
      const phone = await box(page, '.stage-v .phone')
      const row = await box(page, '.stage > .transport')
      const line = await box(page, '.stage > .tl')
      expect(row.width, at).toBeLessThanOrEqual(Math.max(phone.width, 440) + 1)
      expect(Math.abs(line.right - row.right), at).toBeLessThan(2)
      // nothing in the row overflows it or is truncated
      const cut = await page.locator('.stage > .transport').evaluate((el) =>
        Array.from(el.querySelectorAll<HTMLElement>('*'))
          .filter((c) => c.offsetParent !== null && c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflow !== 'visible')
          .map((c) => c.textContent)
      )
      expect(cut, at).toEqual([])
      const parts = await page.locator('.stage > .transport .tr-row > *').evaluateAll((els) => els.map((c) => c.getBoundingClientRect().right))
      expect(Math.max(...parts), at).toBeLessThanOrEqual(row.right + 1)
    }
  } finally {
    await app.close()
  }
})

// The layout audit's small-target findings (r12): words in Cut were 22 px tall, the cover slider 16 px, Settings' links 16 px.
test('fails if a word in Cut, the cover slider or a link in Settings is under 24 px tall', async () => {
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_MOCK_CLAUDE: 'ready' })
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)
    await page.getByTestId('edit-myself').click()
    await page.getByTestId('tab-cut').click()
    const words = await page.locator('[data-testid="words"] .word').evaluateAll((els) => els.map((w) => w.getBoundingClientRect().height))
    expect(words.length).toBeGreaterThan(0)
    expect(Math.min(...words)).toBeGreaterThanOrEqual(24)
    await page.getByTestId('tab-cover').click()
    expect((await box(page, '[data-testid="cover-slider"]')).height).toBeGreaterThanOrEqual(24)
    await page.getByTestId('drawer-close').click()
    await page.getByTestId('account').click()
    for (const id of ['licence-link', 'notices-link', 'update-releases-link']) {
      await page.getByTestId(id).scrollIntoViewIfNeeded()
      expect((await box(page, `[data-testid="${id}"]`)).height, id).toBeGreaterThanOrEqual(24)
    }
  } finally {
    await app.close()
  }
})

// BRIEF layout rule 5 and the audit's new-reel-toast state: "That isn't a video" sat at the window's bottom centre,
// over Choose video.
test("fails if a toast covers the screen's main action or is not centred on the page", async () => {
  const media = makeMedia()
  const { app, page } = await launch({}, { realViewport: true })
  try {
    await passFirstRun(page)
    await page.getByTestId('new-reel').click()
    const stage = page.getByTestId('planned-stage')
    for (const folded of [false, true]) {
      if (folded) await page.keyboard.press('Meta+Backslash')
      for (const size of SIZES) {
        await setSize(app, page, size)
        await stage.getByTestId('file-input').setInputFiles([media.doc])
        const toast = page.getByTestId('toast')
        await expect(toast).toBeVisible()
        await page.waitForTimeout(250)
        const at = `${size[0]}x${size[1]}${folded ? ' folded' : ''}`
        const t = await box(page, '[data-testid="toast"]')
        const main = await box(page, 'main.main')
        const choose = await box(page, '[data-testid="planned-stage"] .btn.primary')
        const meets = t.left < choose.right && choose.left < t.right && t.top < choose.bottom && choose.top < t.bottom
        expect(meets, at).toBe(false)
        expect(Math.abs((t.left + t.right) / 2 - (main.left + main.right) / 2), at).toBeLessThan(2)
        expect(t.left, at).toBeGreaterThanOrEqual(main.left)
        await page.getByTestId('nav-home').click()
        await page.getByTestId('new-reel').click()
      }
    }
  } finally {
    await app.close()
  }
})
