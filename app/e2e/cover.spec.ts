// The cover picker: frames picked from the video in one strip, each named for its time and why, the line under the
// strip saying both for the chosen one, a pick saved as that exact frame, and the frame at the playhead taken as the
// person's own pick. Run after a build:
// npx playwright test e2e/cover.spec.ts
import { test, expect } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sourceAt } from '../src/shared/moments'
import { clock } from '../src/shared/progress'
import { BASE, launch, makeMedia, makeReel, passFirstRun } from './helpers'

const MINE = mkdtempSync(join(BASE, 'cover-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')

test('cover suggestions say when and why, mark the chosen frame, and save it as the frame to render', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data') })
  await passFirstRun(page)
  await makeReel(page, media.video, 10 * 60_000)

  await page.getByTestId('edit-myself').click()
  await page.getByTestId('tab-cover').click()
  const picks = page.getByTestId('cover-pick')
  await expect(picks.first()).toBeVisible()
  // the stand-in engine's first frame: eyes open and face in focus beat its neighbours
  await expect(picks.first()).toHaveAccessibleName(/^0:\d\d, Eyes open, face in focus$/)
  await expect(page.getByText('Drag to fine-tune')).toHaveCount(0)

  await picks.nth(0).click()
  // the frames carry no words; the line under the strip reads the chosen one's
  await expect(page.getByTestId('cover-why')).toHaveText(/^0:\d\d Eyes open, face in focus$/)
  await page.keyboard.press('ArrowRight') // radio buttons: arrows move and pick
  await expect(picks.nth(1)).toHaveAttribute('aria-checked', 'true')
  await expect(picks.nth(1)).toBeFocused()
  await expect(page.locator('[data-testid=cover-pick][aria-checked=true]')).toHaveCount(1)
  const label = (await picks.nth(1).getAttribute('aria-label'))!

  await page.getByTestId('make-version').click()
  await expect(page.getByTestId('drawer')).toHaveCount(0)
  await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 10 * 60_000 }) // saved with its version
  const dir = join(ROOT, 'Projects', readdirSync(join(ROOT, 'Projects'))[0])
  const cover = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).cover
  expect(cover.manual).toBe(true) // the engine renders this frame, no search around it
  expect(label.startsWith(`${clock(cover.atSourceTime)},`)).toBe(true)

  // fails if the cover can't be taken from the frame at the playhead, or that pick isn't said as the person's own
  await page.getByTestId('edit-myself').click()
  await page.getByTestId('tab-cover').click()
  const timeline = page.getByRole('slider', { name: /^Time in your reel/ })
  await timeline.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await expect(timeline).toHaveAttribute('aria-valuenow', '3')
  await page.getByRole('button', { name: 'Use the frame at 0:03' }).click()
  await expect(page.getByTestId('cover-why')).toHaveText('Your pick at 0:03')
  const slug = readdirSync(join(ROOT, 'Projects'))[0]
  const segments = await page.evaluate((s) => window.reel.projects.timeline(s, 2).then((t) => t?.segments ?? []), slug)
  const frame = sourceAt(segments, 3)!
  await page.getByTestId('make-version').click()
  await expect(page.getByTestId('log-play-3')).toBeVisible({ timeout: 10 * 60_000 })
  const taken = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).cover
  expect(taken.manual).toBe(true)
  expect(taken.source).toBe(frame.source)
  expect(taken.atSourceTime).toBeCloseTo(frame.at, 2)
  await app.close()
})
