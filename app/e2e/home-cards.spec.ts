// Reels' stopped cards (spec.md section 4, ux-foundation-b.md 3.4), in the built app with the stand-in engine: a
// Paused or Didn't finish card says why and what happens next, its one action is a pill that moves the reel on, and
// the rest of the card opens the reel.
//
// Run: npm run build && npx playwright test e2e/home-cards.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun, startReel } from './helpers'

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

// fails if a video with no sound sits on "Copying your video", offers Try again or a basic version (both fail the same
// way), or leaves its card without a picture; or if Choose another video doesn't start that same reel again
// (10-28 audit, finding 2)
test('a video with no sound says so where the video would be, and another video starts the reel again', async () => {
  test.setTimeout(8 * 60_000)
  const media = makeMedia()
  const silent = join(mkdtempSync(join(BASE, 'silent-')), 'screen recording.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', silent])
  const { app, page } = await launch(profile('silent'))
  try {
    await passFirstRun(page)
    await startReel(page, silent)
    const stage = page.getByTestId('stage-failed')
    await expect(stage).toHaveText(/^This video has no sound\.Choose another video$/, { timeout: 60_000 })
    await expect(page.getByTestId('copying')).toHaveCount(0)
    await expect(stage.getByTestId('stage-another-video')).toHaveClass(/primary/)
    await expect(page.getByTestId('first-failed')).toContainText('This video has no sound')
    await expect(page.getByTestId('another-video')).toBeVisible()
    await expect(page.getByTestId('retry-first')).toHaveCount(0)
    await expect(page.getByTestId('basic-first')).toHaveCount(0)
    await expect(page.locator('.btn.primary:visible')).toHaveCount(1)
    const slug = await page.locator('.reel-page').getAttribute('data-slug')

    await page.getByTestId('nav-home').click()
    await expect(card(page)).toHaveAttribute('data-state', 'failed')
    // the card shows the file's first frame, not a blank gradient
    await expect(page.locator('.rcard .im img')).toHaveJSProperty('naturalWidth', 320)
    await expect(page.getByRole('button', { name: /^Try again:/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Choose another video:/ })).toBeVisible()
    // its pill takes another video into the same reel, which starts again
    await page.locator('.rcard').getByTestId('file-input').setInputFiles([media.video])
    await expect(card(page)).toHaveAttribute('data-state', 'making')
    await expect(card(page)).toHaveCount(1)
    await card(page).click()
    await expect(page.locator('.reel-page')).toHaveAttribute('data-slug', slug!)
    await expect(page.getByTestId('log-play-1')).toBeVisible({ timeout: 240_000 })
    await expect(page.getByTestId('chat')).toContainText('Your video, my first take.mp4')
  } finally {
    await app.close()
  }
})
