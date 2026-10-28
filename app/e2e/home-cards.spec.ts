// Reels' stopped cards (spec.md section 4, ux-foundation-b.md 3.4), in the built app with the stand-in engine: a
// Paused or Didn't finish card says why and what happens next, its one action is a pill that moves the reel on, and
// the rest of the card opens the reel.
//
// Run: npm run build && npx playwright test e2e/home-cards.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun, startReel } from './helpers'

function profile(name: string) {
  const dir = mkdtempSync(join(BASE, `${name}-`))
  return { REELSTUDIO_ROOT: join(dir, 'Reel Studio'), REELSTUDIO_USER_DATA: join(dir, 'user data') }
}
const card = (page: Page) => page.getByTestId('project-card')
const section = (page: Page, name: string) => page.getByRole('region', { name })

// fails if a paused card only says "Paused", its Resume is not a pill of its own, or pressing the card resumes it
test('a reel you paused says so and what Resume does; the pill resumes it, the card opens it', async () => {
  test.setTimeout(5 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ ...profile('paused'), FAKE_ENGINE_SLOW: '60' })
  try {
    await passFirstRun(page)
    await startReel(page, media.video)
    await page.getByTestId('stop').click()
    await expect(page.getByTestId('first-paused')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('nav-home').click()

    await expect(card(page)).toHaveAttribute('data-state', 'paused')
    await expect(page.getByTestId('card-status')).toHaveText('You paused it · resumes where it stopped')
    const resume = page.getByRole('button', { name: /^Resume:/ })
    await expect(resume).toHaveText('Resume')
    expect((await resume.boundingBox())!.height).toBeGreaterThanOrEqual(24)
    await expect(section(page, 'Needs you').getByTestId('project-card')).toHaveCount(1)

    // the card opens the reel and leaves it paused
    await card(page).click()
    await expect(page.getByTestId('first-paused')).toBeVisible()
    await page.getByTestId('nav-home').click()
    await expect(card(page)).toHaveAttribute('data-state', 'paused')

    // the pill resumes it: the card moves to Making and stops offering Resume
    await resume.click()
    await expect(card(page)).toHaveAttribute('data-state', 'making')
    await expect(section(page, 'Making').getByTestId('project-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Resume:/ })).toHaveCount(0)
  } finally {
    await app.close()
  }
})

// fails if a Didn't finish card hides why, or Try again is missing or doesn't start the reel again
test("a reel that didn't finish says why, and Try again starts it again", async () => {
  test.setTimeout(5 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ ...profile('failed'), FAKE_ENGINE_FAIL: 'transcribe' })
  try {
    await passFirstRun(page)
    await startReel(page, media.video)
    await expect(page.getByTestId('first-failed')).toBeVisible({ timeout: 60_000 })
    await page.getByTestId('nav-home').click()

    await expect(card(page)).toHaveAttribute('data-state', 'failed')
    await expect(page.getByTestId('card-status')).toHaveText('Didn’t finish · Test failure. Try again.')
    await expect(card(page)).toHaveAccessibleName(/Didn’t finish, Test failure\. Try again\.$/)

    await app.evaluate(() => void delete process.env.FAKE_ENGINE_FAIL)
    await page.getByRole('button', { name: /^Try again:/ }).click()
    await expect(card(page)).toHaveAttribute('data-state', 'making')
  } finally {
    await app.close()
  }
})

// fails if Needs you or Making go back to full-size cards, the Making row stops naming its step, or Recent's cards stop
// growing with the window (audit-1028 finding 19)
test('stuck and running reels are short rows, the Making row names its step, and Recent cards grow with the window', async () => {
  test.setTimeout(8 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch(profile('rows'))
  const slow = (seconds: string) => app.evaluate((_e, s) => void (process.env.FAKE_ENGINE_SLOW = s), seconds)
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)
    // one the person paused (Needs you), one still listening (Making)
    await slow('60')
    await startReel(page, media.video)
    await page.getByTestId('stop').click()
    await expect(page.getByTestId('first-paused')).toBeVisible({ timeout: 60_000 })
    await slow('600')
    await startReel(page, media.video)
    await page.getByTestId('nav-home').click()

    for (const name of ['Needs you', 'Making']) {
      const row = section(page, name).locator('[data-slug]')
      await expect(row).toHaveCount(1)
      // a card here was 145 x 257 plus its words; a row is a 40 px picture beside one line
      const box = (await row.boundingBox())!
      expect(box.height, `${name}: a row, not a card`).toBeLessThan(100)
      expect((await row.locator('.rthumb').boundingBox())!.width).toBeLessThanOrEqual(40)
    }
    await expect(section(page, 'Making').getByTestId('card-status')).toHaveText(/^Making Version 1 · .*Listening to your video$/)
    await expect(section(page, 'Needs you').getByRole('button', { name: /^Resume:/ })).toBeVisible()

    // the page is 1280 wide: Recent's card takes a column at least 168 px wide, not 140
    const recent = section(page, 'Recent').locator('.rcard')
    await expect(recent).toHaveCount(1)
    expect((await recent.boundingBox())!.width).toBeGreaterThanOrEqual(168)
  } finally {
    await app.close()
  }
})
