// "Remember this for next time?" for lowercase captions, end to end in the built app with the stand-in engine and
// the mock AI playing a connected Claude Code app (REELSTUDIO_MOCK_CLAUDE=ready): a lowercase note makes a new
// version, the app asks once, Yes saves the rule to What I've learned, the next video starts lowercase, and after Forget
// the video after that does not.
//
// Run: npm run build && npx playwright test e2e/remember-caption-case.spec.ts
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, openSettings, passFirstRun, shot, makeReel } from './helpers'

const MINE = mkdtempSync(join(BASE, 'remember-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')
const projects = (): string[] => readdirSync(join(ROOT, 'Projects')).filter((s) => !s.startsWith('.'))
const captionCase = (slug: string): unknown => JSON.parse(readFileSync(join(ROOT, 'Projects', slug, 'project.json'), 'utf8')).captions?.style?.case

async function newVideo(page: Page, video: string): Promise<string> {
  const before = projects()
  await page.getByTestId('nav-home').click()
  await makeReel(page, video)
  return projects().find((s) => !before.includes(s))!
}

test('a lowercase note is remembered only on Yes, starts the next video lowercase, and stops after Forget', async () => {
  test.setTimeout(15 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data'), REELSTUDIO_MOCK_CLAUDE: 'ready', FAKE_ENGINE_SLOW: '1' })
  try {
    test.skip((await page.evaluate(() => window.reel.app.info())).ai !== 'mock', 'the mock plays the connected AI')
    await passFirstRun(page)
    await openSettings(page)
    await page.getByTestId('use-claude-code').click()
    await expect(page.getByTestId('ai-connected')).toBeVisible()

    // 1-3. the correction, the version it made, and the question with its scope
    const first = await newVideo(page, media.video)
    await page.getByTestId('note-input').fill('make the captions lowercase')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('remember-scope')).toHaveText(/^For new reels\. From Version \d+ of this reel\.$/, { timeout: 120_000 })
    await expect(page.getByTestId('chat')).toContainText('I made the subtitles lowercase.')
    await expect(page.getByTestId('chat')).toContainText('Remember this for next time? "Use lowercase subtitles."')
    expect(captionCase(first)).toBe('lower')
    expect(await page.evaluate(() => window.reel.style.rules())).toEqual([])
    await shot(page, 'remember-01-question')
    await page.getByTestId('action-remember-yes').click()
    await expect(page.getByTestId('chat')).toContainText('Saved. Your next reels will start with lowercase subtitles.')
    await expect(page.getByTestId('action-remember-yes')).toHaveCount(0)

    // 4. the saved rule, where it applies and where it came from
    await page.getByTestId('nav-style').click()
    const rule = page.getByTestId('style-rule')
    await expect(rule).toHaveCount(1)
    await expect(rule).toContainText('Lowercase subtitles')
    await expect(rule).toContainText(/from .+, just now/)
    await shot(page, 'remember-02-my-style')

    // 5. the next video starts lowercase, and says why
    const second = await newVideo(page, media.video)
    expect(captionCase(second)).toBe('lower')
    await expect(page.getByTestId('chat')).toContainText('Subtitles are lowercase, from My style.')

    // 6. Forget stops it
    await page.getByTestId('nav-style').click()
    await page.getByRole('button', { name: 'Forget "Lowercase subtitles"' }).click()
    await expect(page.getByTestId('style-rule')).toHaveCount(0)
    const third = await newVideo(page, media.video)
    expect(captionCase(third)).not.toBe('lower')
    await expect(page.getByTestId('chat')).toContainText('Basic version: pauses cut and subtitles added.')
    await expect(page.getByTestId('chat')).not.toContainText('My style')
  } finally {
    await app.close().catch(() => {})
  }
})
