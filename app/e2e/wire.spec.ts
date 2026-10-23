// The job event contract through the real UI (stand-in engine + the mock AI acting like an AI run with
// REELSTUDIO_MOCK_FIRST_LOOK): Version 1 is made on the Reel screen, whose player switches from the original to
// the first look (a real reel-media video, not ''), tagged; the strip shows "thinking" and time left; then
// Version 1 replaces it.
//
// Run: npx playwright test e2e/wire.spec.ts (after npm run build).
import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun, shot, startReel } from './helpers'

const MINE = mkdtempSync(join(BASE, 'wire-'))

test('wire: the first look plays on the Reel screen, thinking + time left, then Version 1', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({
    REELSTUDIO_ROOT: join(MINE, 'Documents', 'Reel Studio'),
    REELSTUDIO_USER_DATA: join(MINE, 'user data'),
    REELSTUDIO_MOCK_FIRST_LOOK: '12000',
    FAKE_ENGINE_SLOW: '1'
  })
  try {
    await passFirstRun(page)
    await startReel(page, media.video)
    await expect(page.getByTestId('note-progress')).toContainText('Making Version 1')

    // the first look: tagged on the player, a real video that plays (muted)
    await expect(page.getByTestId('first-tag')).toHaveText('First look', { timeout: 120_000 })
    const video = () =>
      page.evaluate(() => {
        const v = document.querySelector('[data-testid=player]') as HTMLVideoElement | null
        return v ? { src: v.currentSrc, ready: v.readyState, t: v.currentTime, w: v.videoWidth, muted: v.muted } : null
      })
    await expect.poll(async () => (await video())?.src ?? '', { timeout: 10_000 }).toMatch(/^reel-media:\/\/.+first-look\.mp4/)
    await expect.poll(async () => (await video())?.t ?? 0, { timeout: 10_000 }).toBeGreaterThan(0.2)
    const v = (await video())!
    expect(v.ready).toBeGreaterThanOrEqual(2)
    expect(v.w).toBeGreaterThan(0)
    expect(v.muted).toBe(true)

    // the editor is "thinking": calm dots instead of a spinner, kept across the once-a-second repeats
    await expect(page.getByTestId('thinking')).toBeVisible()
    await page.waitForTimeout(2500)
    await expect(page.getByTestId('thinking')).toBeVisible()
    await expect(page.getByTestId('note-time-left')).toHaveText(/left|Almost done|longer/)
    await shot(page, 'w-01-making-first-look')

    // done: Version 1 takes the player
    await expect(page.getByTestId('log-play-1')).toBeVisible({ timeout: 240_000 })
    await expect(page.getByTestId('first-tag')).toHaveCount(0)
    await expect.poll(async () => (await video())?.src ?? '').toMatch(/v1/)
    await shot(page, 'w-02-reel-after')
  } finally {
    await app.close().catch(() => {})
  }
})
