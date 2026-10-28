// More reels from this video, with the practice editor: ⋯ asks the editor, the strip waits, the card lists what it
// found, and Make starts a new reel for each pick. A short video reads as one piece and gets no card.
//
// Run: npx playwright test e2e/more-reels.spec.ts (after npm run build).
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun, shot } from './helpers'

const MINE = mkdtempSync(join(BASE, 'more-reels-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')

test('fails if the editor cannot be asked for more reels, the card is wrong, or Make does not start a reel for each pick', async () => {
  test.setTimeout(15 * 60_000)
  const media = makeMedia()
  // the practice editor, thinking 3 s per answer so the wait can be seen
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data'), REELSTUDIO_MOCK_NOTE: '3000' })
  await passFirstRun(page)
  await makeReel(page, media.video, 10 * 60_000)

  await page.getByTestId('more').click()
  await page.getByTestId('more-reels').click()
  const strip = page.getByTestId('note-progress')
  await expect(strip).toContainText('Finding the reels in your video')
  await shot(page, 'more-reels-1-running')
  await expect(strip).toContainText('Waiting for your editor to answer')

  const card = page.getByRole('region', { name: 'Reels in this video' })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('bubble-editor').last()).toHaveText('I found 3 more reels in this video.')
  const rows = card.getByTestId('reels-row')
  await expect(rows).toHaveCount(3)
  // the editor's first pick starts ticked; nothing on the card is a score
  await expect(card.getByRole('checkbox')).toHaveCount(3)
  await expect(card.getByRole('checkbox').first()).toBeChecked()
  await expect(card.getByTestId('reels-make')).toHaveText('Make this reel')
  await expect(card).not.toContainText('%')
  // Share stays the one filled button
  await expect(page.locator('.btn.primary:visible')).toHaveCount(1)
  await page.waitForTimeout(300)
  await shot(page, 'more-reels-2-found')

  // The first pick shows its quote and why (the editor's ranking); the others keep theirs behind a disclosure, so at
  // the smallest window three rows fit with nothing scrolling inside the card (10-28 audit, finding 14).
  const why = (i: number) => rows.nth(i).getByTestId('reels-why')
  await expect(why(0)).toHaveAttribute('aria-expanded', 'true')
  await expect(why(1)).toHaveAttribute('aria-expanded', 'false')
  await why(1).click()
  await expect(rows.nth(1).getByTestId('reels-why-text')).toBeInViewport()
  await why(1).click()
  await expect(why(1)).toHaveAttribute('aria-expanded', 'false')
  await page.setViewportSize({ width: 1100, height: 720 })
  await expect(rows.nth(2)).toBeInViewport({ ratio: 1 })
  await expect(card.getByTestId('reels-make')).toBeInViewport({ ratio: 1 })
  expect(await card.evaluate((el) => [el, ...Array.from(el.querySelectorAll('*'))].filter((n) => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY)).length)).toBe(0)
  // the time readout keeps the reel's length at the smallest window (finding 22)
  await expect(page.getByTestId('time').locator('span')).toBeVisible()
  await shot(page, 'more-reels-2b-found-1100')
  await page.setViewportSize({ width: 1280, height: 820 })

  await card.getByRole('checkbox', { name: 'Bake it hot in a closed pot' }).check()
  await expect(card.getByTestId('reels-make')).toHaveText('Make 2 reels')
  await card.getByTestId('reels-make').click()
  await expect(card.getByTestId('reels-open')).toHaveCount(2)
  // focus moves to the first new reel's Open, not to the page
  await expect(card.getByRole('button', { name: 'Open The one fold that fixed my crumb' })).toBeFocused()
  await expect(card.getByRole('checkbox')).toHaveCount(1)
  await expect(card.getByTestId('reels-make')).toHaveText('Make reels')
  await expect(card.getByTestId('reels-make')).toBeDisabled()
  await expect(page.getByTestId('bubble-editor').last()).toHaveText('2 reels are being made from this video: The one fold that fixed my crumb, Bake it hot in a closed pot.')
  await shot(page, 'more-reels-4-made')

  // Not now folds it to one line; ⋯ opens it again without asking the editor
  await card.getByTestId('reels-later').click()
  await expect(page.getByTestId('reels-found')).toContainText('3 reels found')
  await expect(page.getByTestId('reels-show')).toBeFocused()
  await page.getByTestId('reels-show').click()
  await expect(card.getByRole('checkbox', { name: 'Why I stopped using a mixer' })).toBeFocused()
  await card.getByTestId('reels-later').click()
  await page.getByTestId('more').click()
  await page.getByTestId('more-reels').click()
  await expect(card.getByTestId('reels-row')).toHaveCount(3)
  await expect(strip).toHaveCount(0)

  // each pick is a reel of its own on Home, which reaches Version 1
  await card.getByTestId('reels-open').first().click()
  await expect(page.getByTestId('title')).toHaveText('The one fold that fixed my crumb')
  await page.getByTestId('nav-home').click()
  for (const slug of ['the-one-fold-that-fixed-my-crumb', 'bake-it-hot-in-a-closed-pot']) {
    await expect(page.locator(`.rcard[data-slug="${slug}"]`).getByTestId('card-status')).toHaveText(/^Version 1 · /, { timeout: 5 * 60_000 })
  }

  // a video with one run of speech reads as one piece: a line, and no card
  const short = join(MINE, 'one piece.mp4')
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', short])
  await makeReel(page, short, 10 * 60_000)
  await page.getByTestId('more').click()
  await page.getByTestId('more-reels').click()
  await expect(page.getByTestId('bubble-editor').last()).toHaveText("I didn't find another reel in this video. It reads as one piece.", { timeout: 60_000 })
  await expect(page.getByTestId('reels-found')).toHaveCount(0)
  await shot(page, 'more-reels-3-none')
  await app.close()
})
