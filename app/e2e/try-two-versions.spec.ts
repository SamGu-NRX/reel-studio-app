// Share › Other platforms with Try 2: the editor proposes the one thing Try 2 changes, the creator confirms it, and
// the export writes Try 2 only for the platform that can test it.
//
// Run: npx playwright test e2e/try-two-versions.spec.ts (after npm run build).
import { test, expect } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun, startReel } from './helpers'

const MINE = mkdtempSync(join(BASE, 'tries-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')

test('fails if the editor\'s Try 2 is not proposed, not exported as confirmed, or offered to TikTok', async () => {
  test.setTimeout(15 * 60_000)
  const media = makeMedia()
  // the practice editor: a connected editor that answers from a script
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data'), REELSTUDIO_MOCK_NOTE: '800' })
  await passFirstRun(page)
  await startReel(page, media.video)
  await expect(page.getByTestId('share')).toBeEnabled({ timeout: 10 * 60_000 })

  await page.getByTestId('share').click()
  await page.getByTestId('share-caption').fill('Hi everyone, quick one today\nOne bowl, two folds.\n\n#sourdough')
  await page.getByTestId('share-platforms-toggle').click()
  const platforms = page.getByTestId('share-platforms')
  await expect(platforms.getByRole('checkbox', { name: 'Instagram Reels' })).toBeChecked()

  // Proposed without asking: the hook line, in the editor's voice.
  const things = platforms.getByRole('radiogroup', { name: 'What Try 2 changes' })
  await expect(things.getByRole('radio', { name: 'Hook line' })).toHaveAttribute('aria-checked', 'true')
  await expect(platforms.getByTestId('try-two-proposal')).toContainText('“The one change that fixed my sourdough”')
  await expect(platforms.getByTestId('try-two-reason')).toHaveText(/^I lead with the payoff/)

  // Swapping asks again for that thing; swapping back returns to the hook line.
  await things.getByRole('radio', { name: 'Brightness' }).click()
  await expect(platforms.getByTestId('try-two-proposal')).toContainText('6% brighter')
  await things.getByRole('radio', { name: 'Hook line' }).click()
  await expect(platforms.getByTestId('try-two-reason')).toHaveText(/^I lead with the payoff/)

  await platforms.getByRole('checkbox', { name: 'TikTok' }).check()
  await platforms.getByTestId('try-two-use').click()
  await expect(platforms.getByTestId('try-two-on')).toContainText('Instagram Reels tests both')
  await platforms.getByTestId('export-selected').click()

  await expect(platforms.getByTestId('export-saved')).toBeVisible({ timeout: 120_000 })
  const instagram = platforms.getByTestId('export-platform').filter({ hasText: 'Instagram Reels' })
  await expect(instagram).toContainText('Saved 2 tries for Instagram Reels')
  await expect(instagram).toContainText('Both use the same video.')
  await expect(platforms.getByTestId('export-first-only')).toContainText('TikTok gets Try 1 only.')

  const exports = join(ROOT, 'Library', 'Exports')
  const saved = readdirSync(exports)
  expect(saved.filter((name) => name.includes('Try 2')).sort()).toEqual([expect.stringMatching(/Instagram Reels - Try 2 caption\.txt$/), expect.stringMatching(/Instagram Reels - Try 2 cover\.jpg$/)])
  expect(saved.filter((name) => name.endsWith('.mp4'))).toHaveLength(2)
  const read = (suffix: string) => readFileSync(join(exports, saved.find((name) => name.endsWith(suffix))!), 'utf8')
  // Only the hook line differs between the tries.
  expect(read('Instagram Reels - Try 1 caption.txt')).toBe('Hi everyone, quick one today\nOne bowl, two folds.\n\n#sourdough\n')
  expect(read('Instagram Reels - Try 2 caption.txt')).toBe('The one change that fixed my sourdough\nOne bowl, two folds.\n\n#sourdough\n')
  await app.close()
})
