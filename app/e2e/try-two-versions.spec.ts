// Share › Other platforms with Try 2: Try 2 goes only to a platform that can test it, and the saved
// lines tell the creator how to run Instagram's test.
//
// Run: npx playwright test e2e/try-two-versions.spec.ts (after npm run build).
import { test, expect } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun, startReel } from './helpers'

const MINE = mkdtempSync(join(BASE, 'tries-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')

test('fails if the Saved screen leaves out Instagram\'s Trial steps or offers Try 2 to TikTok', async () => {
  test.setTimeout(15 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data') })
  await passFirstRun(page)
  await startReel(page, media.video)
  await expect(page.getByTestId('share')).toBeEnabled({ timeout: 10 * 60_000 })

  await page.getByTestId('share').click()
  await page.getByTestId('share-platforms-toggle').click()
  const platforms = page.getByTestId('share-platforms')
  for (const name of ['Instagram Reels', 'TikTok']) await platforms.getByRole('checkbox', { name: new RegExp(`^${name}`) }).check()
  await platforms.getByTestId('try-two').check()
  await expect(platforms.getByTestId('try-two-status')).toHaveText('Try 2 is the same as Try 1. Pick another version, cover or caption.')
  await platforms.locator('#platform-caption-2').fill('Open with the result')
  await platforms.getByTestId('export-selected').click()

  await expect(platforms.getByTestId('export-saved')).toBeVisible({ timeout: 120_000 })
  const instagram = platforms.getByTestId('export-platform').filter({ hasText: 'Instagram Reels' })
  await expect(instagram).toContainText('Saved 2 tries for Instagram Reels')
  await expect(instagram).toContainText('Before you share, turn on Trial and leave automatic sharing off.')
  await expect(instagram).toContainText('Both use the same video.')
  await expect(platforms.getByTestId('export-platform').filter({ hasText: 'TikTok' })).toContainText('Saved for TikTok')
  await expect(platforms.getByTestId('export-first-only')).toContainText('TikTok gets Try 1 only.')

  const saved = readdirSync(join(ROOT, 'Library', 'Exports'))
  expect(saved.filter((name) => name.includes('Try 2')).sort()).toEqual([expect.stringMatching(/Instagram Reels - Try 2 caption\.txt$/), expect.stringMatching(/Instagram Reels - Try 2 cover\.jpg$/)])
  expect(saved.filter((name) => name.endsWith('.mp4'))).toHaveLength(2)
  const [caption] = saved.filter((name) => name.endsWith('Instagram Reels - Try 2 caption.txt'))
  expect(readFileSync(join(ROOT, 'Library', 'Exports', caption), 'utf8')).toBe('Open with the result\n')
  await app.close()
})
