// My style as short points, end to end in the built app with the stand-in engine and the mock AI playing a connected
// Claude Code app: a rule remembered from a note goes to the top, newest first, with its kind and where it came
// from; its line opens the note itself; Pause keeps it in its place; Forget leaves Undo, and Undo puts the same
// rule back.
//
// Run: npm run build && npx playwright test e2e/memory-panel.spec.ts
import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, openSettings, passFirstRun, shot } from './helpers'

const MINE = mkdtempSync(join(BASE, 'memory-'))

test('a rule from a note goes to the top of My style, and pauses, forgets and comes back', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({
    REELSTUDIO_ROOT: join(MINE, 'Documents', 'Reel Studio'),
    REELSTUDIO_USER_DATA: join(MINE, 'user data'),
    REELSTUDIO_MOCK_CLAUDE: 'ready',
    FAKE_ENGINE_SLOW: '1'
  })
  try {
    test.skip((await page.evaluate(() => window.reel.app.info())).ai !== 'mock', 'the mock plays the connected AI')
    await passFirstRun(page)
    await openSettings(page)
    await page.getByTestId('use-claude-code').click()
    await expect(page.getByTestId('ai-connected')).toBeVisible()

    // an older rule, typed in
    await page.getByTestId('nav-style').click()
    await page.getByRole('button', { name: 'Add a rule' }).click()
    await page.getByRole('textbox', { name: 'New rule' }).fill('Always use big subtitles')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('style-rule')).toHaveCount(1)

    // a note that asks to remember, and Yes
    await page.getByTestId('nav-home').click()
    await makeReel(page, media.video)
    await page.getByTestId('note-input').fill('always keep the music quieter when I talk')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('chat')).toContainText('Remember this for next time?', { timeout: 120_000 })
    await page.getByRole('button', { name: 'Yes, remember it' }).click()
    await expect(page.getByTestId('chat')).toContainText('You can pause or forget it in My style.')

    // newest first, with its kind and where it came from; only a paused rule is marked
    await page.getByTestId('nav-style').click()
    const rows = page.getByTestId('style-rule')
    await expect(rows).toHaveCount(2)
    const top = rows.first()
    const line = top.getByRole('button', { name: 'Music: Keep the music quieter when I talk' })
    await expect(line).toBeVisible()
    await expect(top).toContainText(/from your note on “.+”, just now/)
    await expect(top).not.toContainText('Paused')
    await expect(rows.nth(1)).toContainText('Big subtitles')
    await expect(rows.nth(1)).toContainText('added by you')

    // the line opens the sentence the editor reads and the note it came from
    await line.click()
    await expect(line).toHaveAttribute('aria-expanded', 'true')
    await expect(top).toContainText('“Always keep the music quieter when I talk.”')
    await expect(top).toContainText(/Your note “always keep the music quieter when I talk” on (Version \d+ of )?“.+” · Saved /)
    await expect(top).toContainText('Your editor reads this on every new reel.')
    await shot(page, 'memory-open')
    await line.click()
    await expect(line).toHaveAttribute('aria-expanded', 'false')

    // Pause keeps it where it is
    await top.getByRole('button', { name: 'Pause "Keep the music quieter when I talk"' }).click()
    await expect(top).toContainText('Paused')
    await expect(rows.first()).toContainText('Keep the music quieter when I talk')
    await shot(page, 'memory-paused')

    // Forget leaves Undo in its place
    await page.getByRole('button', { name: 'Forget "Keep the music quieter when I talk"' }).click()
    const forgot = page.getByRole('status').filter({ hasText: 'Forgot “Keep the music quieter when I talk”.' })
    await expect(forgot).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused()
    await expect(rows).toHaveCount(1)
    expect((await page.evaluate(() => window.reel.style.rules())).map((r) => r.text)).toEqual(['Always use big subtitles.'])
    await shot(page, 'memory-forgot')

    // Undo: the same rule, still paused, back on top, and focus back on its Forget
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Keep the music quieter when I talk')
    await expect(rows.first()).toContainText('Paused')
    await expect(page.getByRole('button', { name: 'Forget "Keep the music quieter when I talk"' })).toBeFocused()
    const back = (await page.evaluate(() => window.reel.style.rules())).find((r) => r.text.startsWith('Always keep the music'))
    expect(back).toMatchObject({ paused: true, source: { note: 'always keep the music quieter when I talk' } })
  } finally {
    await app.close().catch(() => {})
  }
})
