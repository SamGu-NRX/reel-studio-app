// Grandma-test fixes, end to end with NO AI connected: an honest Version 1, no AI offer except one connect
// line, the caption controls, a song and a picture under Edit it myself, the simple Connect screen, and
// "where did my video go?" after Export.
//
// Run: npm run e2e (or `npx playwright test e2e/ux.spec.ts` after a build). Same env as smoke.spec.ts.
import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, CLAUDE_CODE_LABEL, CLAUDE_CODE_MISNAMED, USE_CLAUDE_CODE, launch, makeMedia, makeReel, passFirstRun, shot, openSettings } from './helpers'

// Its own Reel Studio folder: the smoke test leaves a song in the shared Library, and this test
// needs the "No music yet" state.
const MINE = mkdtempSync(join(BASE, 'ux-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')

/** The native file picker cannot be driven, so answer it from the main process. */
async function answerFilePicker(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, f) => {
    ;(dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [f] })
  }, file)
}

function projectJson(): any {
  const dir = join(ROOT, 'Projects')
  const slug = readdirSync(dir).find((s) => {
    try {
      readFileSync(join(dir, s, 'project.json'))
      return true
    } catch {
      return false
    }
  })!
  return JSON.parse(readFileSync(join(dir, slug, 'project.json'), 'utf8'))
}

test('no AI: honest first version, one connect prompt, caption controls, a song and a picture, export', async () => {
  test.setTimeout(20 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data') })
  await passFirstRun(page)

  // Sidebar says plainly that no AI is on, and is a way in.
  await expect(page.getByTestId('ai-status')).toHaveText('No AI editor')

  await makeReel(page, media.video, 10 * 60_000)
  const aiSource = await page.evaluate(() => window.reel.app.info().then((i) => i.ai))
  const noAi = aiSource === 'mock' || !(await page.evaluate(() => window.reel.ai.active().then((a) => a.connected && a.id !== 'none')))
  expect(noAi).toBe(true)

  // ---- 1. honest: Version 1 says it is a basic version, and nobody says "I" ----
  await expect(page.getByTestId('log-video')).toContainText('Your video')
  await expect(page.locator('.nt-res[data-v="1"]')).toContainText('Basic version: pauses and retakes removed')
  // it offers what an AI would add, and never claims to have done it
  await expect(page.getByTestId('chat')).not.toContainText(/Kept your best takes|picked your best takes/i)
  await expect(page.getByTestId('chat')).not.toContainText('Wrote your post caption')
  await expect(page.getByTestId('edit-myself')).toContainText('Edit it myself')
  await expect(page.getByTestId('version-on-screen')).toContainText('Version 1')
  await shot(page, 'ux-01-reel-no-ai')

  // ---- 2. the post caption is not part of the video: it lives in Share, not in Edit it myself ----
  await page.getByTestId('edit-myself').click()
  await expect(page.getByTestId('tab-cut')).toBeVisible()
  await expect(page.getByTestId('tab-post')).toHaveCount(0)
  await page.getByTestId('drawer-close').click()
  await expect(page.getByTestId('drawer')).toHaveCount(0)

  // ---- 3. no AI: nothing offers an AI change; the editor picker sits where the note box was ----
  await expect(page.getByTestId('note-input')).toHaveCount(0)
  await expect(page.getByTestId('moment-suggest')).toHaveCount(0)
  await page.keyboard.press('c') // pointing at a spot opens nothing either
  await expect(page.getByTestId('pointer')).toHaveCount(0)
  const picker = page.getByTestId('composer-connect')
  await expect(picker).toContainText('Connect an editor to leave notes')
  await expect(picker.getByTestId('signin-chatgpt')).toBeVisible()
  await expect(picker.getByTestId('without-ai')).toHaveText('Without an editor, Reel Studio makes a basic version: pauses and retakes removed, subtitles and a cover.')
  await expect(picker.getByTestId('claude-key-toggle')).toBeHidden()
  await shot(page, 'ux-03-no-ai-connect')
  await picker.getByTestId('ai-advanced').click()
  await expect(picker.getByTestId('claude-key-toggle')).toHaveText('Add key')
  await picker.getByTestId('claude-key-toggle').click()
  await expect(picker.getByTestId('claude-key-input')).toBeVisible()
  await shot(page, 'ux-06-connect-claude-key')

  // ---- 4. subtitles under Edit it myself: a quick preview first, then the version, said in plain words ----
  await page.getByTestId('edit-myself').click()
  await page.getByTestId('tab-captions').click()
  await expect(page.getByTestId('caption-controls')).toBeVisible()
  await expect(page.getByTestId('cap-size-medium')).toHaveAttribute('aria-checked', 'true') // 105 px default
  await expect(page.getByTestId('cap-pos-lower')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('cap-look-clean')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('cap-color-white')).toHaveAttribute('aria-checked', 'true')
  await shot(page, 'ux-07-captions-tab')
  await page.getByTestId('cap-size-big').click()
  await page.getByTestId('cap-pos-higher').click()
  await page.getByTestId('cap-color-yellow').click()
  await shot(page, 'ux-08-captions-picked')
  await page.getByTestId('make-version').click()
  await expect(page.getByTestId('note-progress')).toBeVisible()
  await expect(page.getByTestId('note-progress')).toBeInViewport() // never scrolled out of sight
  // a manual change says what it is (grandma 2: "Adding pictures" for a colour change) and shows a quick preview first
  await expect(page.getByTestId('note-progress')).toContainText(/Making your changes|Making Version 2/)
  await expect(page.getByTestId('change-preview')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('share')).toBeDisabled() // and Share waits for it
  await shot(page, 'ux-09-new-version-working')
  await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 10 * 60_000 })
  const style = projectJson().captions.style
  expect([style.size, style.position, style.color, !!style.box]).toEqual([126, 0.66, '#FFD60A', false])
  // The notes log says what changed (critique 1.8): the version's line, open on the newest.
  await expect(page.getByTestId('log-hand').last()).toContainText('You changed')
  await expect(page.locator('.nt-res[data-v="2"]')).toContainText(/bigger yellow subtitles, moved up/i)
  await expect(page.locator('.nt-res[data-v="2"] + .acc')).toContainText(/Subtitle/)

  // ---- 5. a song: Music under Edit it myself, the picker, a new version with the song ----
  await answerFilePicker(app, media.song)
  await page.getByTestId('edit-myself').click()
  await page.getByTestId('tab-music').click()
  await page.getByTestId('music-add').click()
  await page.getByTestId('make-version').click()
  await expect(page.getByTestId('log-play-3')).toBeVisible({ timeout: 10 * 60_000 })
  // project.json only takes Library-relative paths (secfix): never the picked file's own path.
  expect(projectJson().music.track).toBe('Library/Music/happy song.mp3')

  // ---- 6. pictures: pick a picture, click the word ----
  await answerFilePicker(app, media.picture)
  await page.getByTestId('edit-myself').click()
  await page.getByTestId('tab-broll').click()
  await page.getByTestId('picture-add').click()
  await expect(page.getByTestId('pick-word')).toBeVisible()
  await shot(page, 'ux-10-pick-word')
  await page.locator('.pick-words .word').nth(1).click()
  await expect(page.getByTestId('drawer')).toContainText('Above your head')
  await expect(page.getByTestId('broll-thumb')).toBeVisible() // a small picture, not a file name (grandma 2)
  await shot(page, 'ux-10b-pictures-list')
  await page.getByTestId('make-version').click()
  await expect(page.getByTestId('log-play-4')).toBeVisible({ timeout: 10 * 60_000 })
  const broll = projectJson().broll
  expect(broll).toHaveLength(1)
  expect(broll[0].asset).toBe('Library/Images/logo.png')
  await shot(page, 'ux-11-reel-after-edits')

  // ---- 7. Share: Show in Explorer/Finder saves the file and names it ----
  await expect(page.getByTestId('share')).toBeEnabled({ timeout: 10 * 60_000 })
  await page.getByTestId('share').click()
  const where = process.platform === 'darwin' ? 'Show in Finder' : 'Show in Explorer'
  await expect(page.getByTestId('share-finder')).toContainText(where)
  await page.getByTestId('share-finder').click()
  await expect(page.getByTestId('share-pop')).toContainText(' - Version 4.mp4', { timeout: 10 * 60_000 })
  await shot(page, 'ux-12-share')
  const exported = readdirSync(join(ROOT, 'Library', 'Exports'))
  expect(exported.some((f) => f.endsWith(' - Version 4.mp4'))).toBe(true)
  expect(exported.some((f) => /\(\d\)/.test(f))).toBe(false)
  await page.keyboard.press('Escape')

  // ---- 8. Library: no Finished videos bin; reels live on Reels ----
  await page.getByTestId('nav-library').click()
  await expect(page.getByTestId('library-tab-images')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('Finished videos')).toHaveCount(0)
  await shot(page, 'ux-13-library')

  // ---- 9. Settings uses the same simple connect panel ----
  await openSettings(page)
  await expect(page.getByTestId('signin-chatgpt')).toBeVisible()
  await shot(page, 'ux-14-settings')
  await app.close()
})

// The one build offers the person's own Claude Code app in its real state. The mock AI plays each state
// (REELSTUDIO_MOCK_CLAUDE); no terminal ever opens in mock mode, the launcher file is still written and checked.
async function claudeScreen(state: string, env: Record<string, string> = {}) {
  const mine = mkdtempSync(join(BASE, `claude-${state}-`))
  const userData = join(mine, 'user data')
  const { app, page } = await launch({
    REELSTUDIO_MOCK_CLAUDE: state,
    REELSTUDIO_ROOT: join(mine, 'Documents', 'Reel Studio'),
    REELSTUDIO_USER_DATA: userData,
    ...env
  })
  await passFirstRun(page)
  const info = await page.evaluate(() => window.reel.app.info())
  // one build: no flavour field, just these
  expect(Object.keys(info).sort()).toEqual(['ai', 'dev', 'engine', 'fasterExports', 'firstRunDone', 'models', 'phoneView', 'platform', 'root', 'rootDisplay', 'sharing', 'test', 'userName', 'version'])
  await openSettings(page)
  await expect(page.getByTestId('signin-chatgpt')).toBeVisible()
  return { app, page, info, userData, panel: page.locator('#sec-editor') }
}

test('Claude Code app ready: "Use Claude (your Claude Code app)" comes first, but only a click turns it on', async () => {
  const { app, page, info, panel } = await claudeScreen('ready')
  test.skip(info.ai !== 'mock', 'the mock plays the Claude Code states')
  await expect(page.getByTestId('use-claude-code')).toHaveAccessibleName(USE_CLAUDE_CODE)
  await expect(panel.locator('.pv-main > button').first()).toHaveAttribute('data-testid', 'use-claude-code')
  await expect(page.getByTestId('use-claude-code')).toHaveClass(/primary/)
  await expect(page.getByTestId('signin-chatgpt')).not.toHaveClass(/primary/)
  await expect(panel).toContainText(/Found on this (Mac|PC)/)
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none') // never picked on its own
  await shot(page, 'ux-15-connect-claude-ready')
  await page.getByTestId('use-claude-code').click()
  await expect(page.getByTestId('ai-connected')).toHaveText('Connected')
  await page.getByTestId('nav-home').click() // the sidebar re-reads the AI editor on every screen change
  await expect(page.getByTestId('ai-status')).toHaveText('AI editor: Claude')
  expect(await page.locator('body').innerText()).not.toMatch(CLAUDE_CODE_MISNAMED)
  expect(await page.locator('body').innerText()).not.toContain('—')
  await shot(page, 'ux-16-connect-claude-using')
  await app.close()
})

test('Claude Code app not signed in: a sign-in window, then it waits and connects', async () => {
  const { app, page, info, userData, panel } = await claudeScreen('signs_in')
  test.skip(info.ai !== 'mock', 'the mock plays the Claude Code states')
  await expect(panel.locator('.pv-main > button').first()).toHaveAttribute('data-testid', 'signin-chatgpt')
  await expect(page.getByTestId('signin-chatgpt')).toHaveClass(/primary/)
  await expect(page.getByTestId('claude-code-signin')).toHaveAccessibleName('Sign in to your Claude Code app')
  await expect(panel).toContainText('Sign in with your plan')
  expect(await page.locator('body').innerText()).not.toMatch(CLAUDE_CODE_MISNAMED)
  await shot(page, 'ux-17-connect-claude-signed-out')
  await page.getByTestId('claude-code-signin').click()
  await expect(page.getByTestId('claude-code-waiting')).toBeVisible()
  await shot(page, 'ux-18-connect-claude-waiting')
  // the mock "signs in" 1.5 s after the window opens; the 3 s re-check notices and switches to it
  await expect(page.getByTestId('ai-connected')).toHaveText('Connected', { timeout: 15_000 })
  const launcher = join(userData, 'claude-sign-in', process.platform === 'win32' ? 'Sign in to Claude.cmd' : 'Sign in to Claude.command')
  const script = readFileSync(launcher, 'utf8')
  expect(script).toContain('auth login --claudeai')
  expect(script).toContain('Sign in to Claude in this window.')
  await app.close()
})

test('Claude Code app not installed: a quiet "Use Claude instead" with plain install steps', async () => {
  const { app, page, info, panel } = await claudeScreen('missing')
  test.skip(info.ai !== 'mock', 'the mock plays the Claude Code states')
  await expect(page.getByTestId('signin-chatgpt')).toHaveClass(/primary/)
  await expect(page.getByTestId('claude-code-install')).toHaveCount(0)
  await page.getByTestId('claude-code-toggle').click()
  const steps = page.getByTestId('claude-code-install')
  await expect(steps.locator('a')).toHaveAttribute('href', 'https://code.claude.com/docs/en/setup')
  await expect(steps).toContainText(/Follow the steps for your (Mac|PC)\./)
  await expect(steps).toContainText('Come back here and click Check again.')
  await expect(steps).toContainText('The Claude Code app needs a paid Claude plan (Pro or Max).')
  await expect(page.getByTestId('claude-code-check')).toBeVisible()
  expect(await page.locator('body').innerText()).not.toMatch(CLAUDE_CODE_MISNAMED)
  await shot(page, 'ux-19-connect-claude-missing')
  await app.close()
})

test('Claude Code app broken: a plain line and the install page', async () => {
  const { app, page, info, panel } = await claudeScreen('broken')
  test.skip(info.ai !== 'mock', 'the mock plays the Claude Code states')
  await expect(panel).toContainText("Your Claude Code app didn't start")
  await page.getByTestId('claude-code-toggle').click()
  const choice = page.locator('[data-testid=claude-code-choice][data-state=broken]')
  await expect(choice.locator('a')).toHaveAttribute('href', 'https://code.claude.com/docs/en/setup')
  await shot(page, 'ux-20-connect-claude-broken')
  await app.close()
})

test('fails if "Use Claude" says Connected before the check call answers, or a failed check hides why', async () => {
  const slow = await claudeScreen('ready', { REELSTUDIO_MOCK_CLAUDE_CHECK: '2500' })
  test.skip(slow.info.ai !== 'mock', 'the mock plays the Claude Code states')
  await slow.page.getByTestId('use-claude-code').click()
  await expect(slow.panel).toContainText('Checking Claude…')
  await expect(slow.page.getByTestId('ai-connected')).toHaveCount(0)
  await expect(slow.page.getByTestId('ai-connected')).toHaveText('Connected', { timeout: 10_000 })
  await slow.app.close()

  const limited = await claudeScreen('ready', { REELSTUDIO_MOCK_CLAUDE_CHECK: 'limited' })
  await limited.page.getByTestId('use-claude-code').click()
  await expect(limited.panel.getByRole('alert')).toHaveText('Your Claude plan is at its limit. Try again after it resets.')
  await expect(limited.page.getByTestId('claude-try-again')).toBeVisible()
  await expect(limited.page.getByTestId('ai-connected')).toHaveCount(0)
  expect((await limited.page.evaluate(() => window.reel.ai.active())).id).toBe('none')
  await limited.app.close()
})
