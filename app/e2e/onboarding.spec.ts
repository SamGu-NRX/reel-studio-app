// macOS's own questions cannot be answered from a test, so a test build stands in for them (main/permissions.ts
// parseFakes), logs the System Settings page instead of opening it, and shows the helper at a fixed place.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, openSettings } from './helpers'

const MAC = process.platform === 'darwin'

function fresh(name: string) {
  const dir = mkdtempSync(join(BASE, `onboarding-${name}-`))
  const documents = join(dir, 'Documents')
  const movies = join(dir, 'Movies')
  mkdirSync(documents)
  mkdirSync(movies)
  const userData = join(dir, 'user data')
  // No REELSTUDIO_ROOT: the real default folders inside stand-in Documents and Movies. A new install keeps its
  // library in Movies; an install from before keeps it in Documents (main/settings.ts settleLibraryRoot).
  return {
    root: join(movies, 'Reel Studio'),
    legacyRoot: join(documents, 'Reel Studio'),
    userData,
    env: { REELSTUDIO_ROOT: '', REELSTUDIO_DOCUMENTS: documents, REELSTUDIO_MOVIES: movies, REELSTUDIO_USER_DATA: userData, REELSTUDIO_MODELS_DIR: join(dir, 'models') }
  }
}

/** System Settings pages the app would have opened. */
const opened = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as any).__reelPermLog.opened)

/** The helper window beside System Settings, once it is open. */
async function helperWindow(app: ElectronApplication, title: string): Promise<Page> {
  await expect.poll(async () => (await Promise.all(app.windows().map((w) => w.title()))).includes(title)).toBe(true)
  for (const w of app.windows()) if ((await w.title()) === title) return w
  throw new Error(`no helper window "${title}"`)
}

test('a fresh first run goes welcome, sample, editor, and ends on a new reel with no video', async () => {
  const d = fresh('walk')
  const { app, page } = await launch(d.env)
  try {
    await expect(page.getByTestId('get-started')).toBeVisible()
    expect(existsSync(d.root)).toBe(false)
    await page.getByTestId('get-started').click()

    // the sample is made with Version 1's own rows, one for each thing the welcome promised
    await expect(page.getByTestId('steps-list').locator('.sl')).toHaveText([
      'Listening to your video',
      'Cutting pauses and repeated starts',
      'Picking your best takes and pictures',
      'Adding subtitles',
      'Making your cover'
    ])
    await page.getByTestId('demo-skip').click()
    // with no editor, the takes-and-pictures row says it was skipped, and the steps fold into Version 1's line
    await expect(page.getByTestId('sample-v1')).toContainText(/Version 1.*0:24 down to 0:12/)
    await expect(page.getByTestId('steps-list')).toHaveCount(0)
    await page.getByTestId('demo-next').click()

    await expect(page.getByRole('heading', { name: 'Choose your editor' })).toBeFocused() // a screen reader starts at the new step
    await expect(page.getByTestId('without-ai')).toContainText('Without an editor, Reel Studio makes a basic version')
    await page.getByTestId('not-now').click()

    // Your turn: the reel slice's planning space, in the app's own window
    await expect(page.getByTestId('planned-stage')).toContainText('Drop the video you filmed')
    await expect(page.getByTestId('plan-empty')).toBeVisible()
    await expect(page.getByTestId('nav-home')).toBeVisible()
    const list = await page.evaluate(() => window.reel.projects.list())
    expect(list.map((p) => p.noVideo)).toEqual([true])

    const settings = JSON.parse(readFileSync(join(d.userData, 'settings.json'), 'utf8'))
    expect(settings.firstRunDone).toBe(true)
    // Help improve is asked after the first Share, never here (ux-foundation-b.md section 4)
    expect(settings.sharing).toMatchObject({ asked: false, on: false })
    // a Mac's notifications are asked during the first Version 1, so they start off
    expect(settings.notifications).toBe(MAC ? false : null)
    // the library is made in Movies without a question
    expect(existsSync(join(d.root, 'Projects'))).toBe(true)
    expect(await opened(app)).toEqual([])
  } finally {
    await app.close()
  }
})

test('fails if connecting Claude does not upgrade the sample, or the sound switch is not remembered', async () => {
  const d = fresh('claude')
  const { app, page } = await launch({ ...d.env, REELSTUDIO_MOCK_CLAUDE: 'ready', REELSTUDIO_MOCK_CLAUDE_CHECK: '600' })
  try {
    await page.getByTestId('get-started').click()
    await expect(page.getByTestId('sound-effects')).toHaveText('Sound effects: on')
    await page.getByTestId('sound-effects').click()
    await expect(page.getByTestId('sound-effects')).toHaveText('Sound effects: off')
    await expect.poll(() => page.evaluate(() => window.reel.app.info().then((i) => i.soundEffects))).toBe(false)

    await page.getByTestId('demo-skip').click()
    await page.getByTestId('demo-next').click()
    // a signed-in Claude Code leads, with the one filled button; nothing is connected until the check answers
    await expect(page.getByTestId('use-claude-code')).toHaveClass(/primary/)
    await page.getByTestId('use-claude-code').click()
    await expect(page.getByTestId('ai-connected')).toBeVisible()
    await expect(page.getByTestId('sample-v2')).toContainText(/Version 2.*What an editor adds: a better take and two pictures/)
    await expect(page.getByTestId('version-on-screen')).toHaveText('Version 2')
    await expect(page.getByTestId('time')).toContainText('/ 0:09')
    await page.getByTestId('editor-continue').click()
    await expect(page.getByTestId('planned-stage')).toBeVisible()
    expect(await page.evaluate(() => window.reel.ai.active().then((p) => p.id))).toBe('claude-cli')
    expect(JSON.parse(readFileSync(join(d.userData, 'settings.json'), 'utf8')).soundEffects).toBe(false)
  } finally {
    await app.close()
  }
})

test('an existing install goes straight to Home, as before', async () => {
  const d = fresh('existing')
  mkdirSync(d.userData, { recursive: true })
  writeFileSync(join(d.userData, 'settings.json'), JSON.stringify({ firstRunDone: true, root: null }))
  const { app, page } = await launch(d.env)
  try {
    await expect(page.getByRole('heading', { name: 'Reels' })).toBeVisible()
    await expect(page.getByTestId('get-started')).toHaveCount(0)
    await expect(page.getByTestId('setup-steps')).toHaveCount(0)
    // made at start, in Documents, where an install from before the Movies default always kept it
    expect(existsSync(join(d.legacyRoot, 'Projects'))).toBe(true)
    expect(existsSync(d.root)).toBe(false)
    // Notifications were on before this setup existed, so they still are.
    const st = await page.evaluate(() => (window as any).reel.perm.status())
    expect(st).toMatchObject({ folder: 'allowed', notifications: 'unverified' })
    // Settings has the switch for anyone who skipped it in setup
    await openSettings(page)
    await expect(page.getByTestId('notifications-toggle')).toBeChecked()
    if (MAC) {
      // macOS never says whether they show, so System Settings is always one press away.
      await page.getByTestId('notifications-settings').click()
      await expect.poll(() => opened(app)).toEqual(['x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=dev.reelstudio.app'])
    }
  } finally {
    await app.close()
  }
})

test('folder access taken away after setup can be given back from Settings', async () => {
  test.skip(!MAC, 'macOS privacy only')
  const d = fresh('revoked')
  mkdirSync(d.userData, { recursive: true })
  writeFileSync(join(d.userData, 'settings.json'), JSON.stringify({ firstRunDone: true, root: null }))
  const { app, page } = await launch({ ...d.env, REELSTUDIO_TEST_PERMISSIONS: 'folder=denied' })
  try {
    await openSettings(page)
    await expect(page.getByTestId('folder-problem')).toContainText("Your Mac isn't letting Reel Studio use this folder")
    await page.getByTestId('folder-allow').click()
    await expect.poll(() => opened(app)).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'])
    await helperWindow(app, 'Set up Files and Folders')
    await app.evaluate(() => {
      delete (globalThis as { __reelPermFakes?: { folder?: string } }).__reelPermFakes!.folder
    })
    await expect.poll(() => app.windows().length, { timeout: 5000 }).toBe(1)
    await expect(page.getByTestId('folder-problem')).toHaveCount(0, { timeout: 5000 })
  } finally {
    await app.close()
  }
})
