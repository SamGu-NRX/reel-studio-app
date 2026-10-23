// Edit it myself > Sound, end to end: sounds added at the playhead from the picker, each named for what it is and
// where it plays, marked on the timeline (a mark picks its row), then a level, a removal, another sound and the
// music's fade-in, and the new version carries each of them.
//
// Run: npx playwright test e2e/edit-sounds.spec.ts after a build. Same env as smoke.spec.ts.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun, shot } from './helpers'

const MINE = mkdtempSync(join(BASE, 'sounds-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')

function projectJson(): any {
  const dir = join(ROOT, 'Projects')
  const slug = readdirSync(dir).find((s) => readdirSync(join(dir, s)).includes('project.json'))!
  return JSON.parse(readFileSync(join(dir, slug, 'project.json'), 'utf8'))
}

/** Moves the playhead to `seconds` from the timeline, as the keyboard does. */
async function playheadTo(page: Page, seconds: number): Promise<void> {
  const timeline = page.getByRole('slider', { name: /^Time in your reel/ })
  await timeline.focus()
  await page.keyboard.press('Home')
  for (let i = 0; i < seconds; i++) await page.keyboard.press('ArrowRight')
  await expect(timeline).toHaveAttribute('aria-valuenow', String(seconds))
}

async function addSound(page: Page, choice: string): Promise<void> {
  await page.getByRole('button', { name: /^Add a sound at \d:\d\d$/ }).click()
  const picker = page.getByRole('group', { name: /^Add a sound at/ })
  await expect(picker).toBeVisible()
  await picker.getByRole('radio', { name: choice }).click()
  await expect(picker.getByRole('radio', { name: choice })).toHaveAttribute('aria-checked', 'true')
  await picker.getByRole('button', { name: `Add ${choice.toLowerCase()}` }).click()
  await expect(picker).toHaveCount(0)
}

test('sounds: add at the playhead, a level, a removal and a fade, carried by the new version', async () => {
  test.setTimeout(20 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data') })
  await passFirstRun(page)
  await makeReel(page, media.video, 10 * 60_000)

  // ---- a song and two sounds, each added at the playhead ----
  await answerFilePicker(app, media.song)
  await page.getByRole('button', { name: 'Edit it myself' }).click()
  await page.getByRole('tab', { name: 'Sound' }).click()
  await page.getByRole('button', { name: /^Add a song from this/ }).click()
  await expect(page.getByRole('slider', { name: 'Music fade-in' })).toBeVisible()
  await playheadTo(page, 2)
  await addSound(page, 'Whoosh, quick')
  await playheadTo(page, 6)
  await addSound(page, 'Hit, punch')

  const rows = page.getByTestId('sfx-row')
  await expect(rows).toHaveCount(2)
  // named for what it is, when, and why there; never the file
  await expect(rows.nth(0).getByRole('button').first()).toHaveText(/^Whoosh at 0:0[23] · on “\w+”$/)
  await expect(rows.nth(1).getByRole('button').first()).toHaveText(/^Hit at 0:0[67] · on “\w+”$/)
  await expect(page.getByTestId('drawer')).not.toContainText('.opus')
  // on the timeline, and a mark picks its row
  const marks = page.getByRole('group', { name: 'Sound effects on the timeline' }).getByRole('button')
  await expect(marks).toHaveCount(2)
  await expect(page.getByTestId('timeline-music')).toBeVisible()
  await marks.nth(1).click()
  await expect(rows.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(rows.nth(1)).toBeInViewport()
  await expect(marks.nth(1)).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Make Version 2' }).click()
  await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 10 * 60_000 })
  const v2 = projectJson()
  expect(v2.music.track).toBe('Library/Music/happy song.mp3')
  expect(v2.sfx.map((s: any) => s.sound)).toEqual(['whoosh-quick', 'impact-punch'])
  const [whoosh, hit] = v2.sfx

  // ---- a level, a removal, a sound added at the playhead, the music's fade-in ----
  await page.getByRole('button', { name: 'Edit it myself' }).click()
  await page.getByRole('tab', { name: 'Sound' }).click()
  const level = page.getByRole('slider', { name: /^Level of Whoosh at/ })
  await level.focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft')
  await expect(rows.nth(0)).toContainText('−6 dB')
  await page.getByRole('button', { name: /^Remove Hit at/ }).click()
  await expect(rows).toHaveCount(1)
  await playheadTo(page, 9)
  await addSound(page, 'Ding, idea')
  await expect(rows.nth(1).getByRole('button').first()).toHaveText(/^Ding at 0:(09|10) · on “\w+”$/)
  const fadeIn = page.getByRole('slider', { name: 'Music fade-in' })
  await fadeIn.focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('fades')).toContainText('1.2 s')
  await expect(page.getByTestId('change-count')).toHaveText('4 changes')
  await shot(page, 'sounds-01-edited')

  await page.getByRole('button', { name: 'Make Version 3' }).click()
  await expect(page.getByTestId('log-play-3')).toBeVisible({ timeout: 10 * 60_000 })
  const v3 = projectJson()
  expect(v3.music.fadeIn).toBe(1.2)
  expect(v3.sfx).toHaveLength(2)
  expect(v3.sfx[0]).toEqual({ ...whoosh, gainDb: -6 })
  expect(v3.sfx.some((s: any) => JSON.stringify(s.at) === JSON.stringify(hit.at))).toBe(false)
  expect(v3.sfx[1].sound).toBe('ding-idea')
  expect(v3.sfx[1].at.word).toBeTruthy()
  // the version's line says what changed
  await expect(page.locator('.nt-res[data-v="3"]')).toContainText('music fades in over 1.2 s')
  await expect(page.locator('.nt-res[data-v="3"] + .acc')).toContainText('Whoosh level')

  await app.close()
})

/** The native file picker cannot be driven, so answer it from the main process. */
async function answerFilePicker(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, file)
}
