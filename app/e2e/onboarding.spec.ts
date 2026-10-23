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
  const userData = join(dir, 'user data')
  // No REELSTUDIO_ROOT: the default folder, "Documents › Reel Studio", inside the stand-in Documents.
  return {
    root: join(documents, 'Reel Studio'),
    userData,
    env: { REELSTUDIO_ROOT: '', REELSTUDIO_DOCUMENTS: documents, REELSTUDIO_USER_DATA: userData, REELSTUDIO_MODELS_DIR: join(dir, 'models') }
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

test('a fresh first run walks every step, and the folder waits for Allow', async () => {
  const d = fresh('walk')
  const { app, page } = await launch(d.env)
  try {
    await expect(page.getByTestId('get-started')).toBeVisible()
    // Nothing is made in Documents before setup has said why (macOS would ask with no explanation).
    expect(existsSync(d.root)).toBe(false)
    await page.getByTestId('get-started').click()

    await expect(page.locator('.fr-steps li')).toHaveText(MAC ? ['The sample', 'Your Mac', 'AI editor'] : ['The sample', 'AI editor'])
    await expect(page.getByTestId('setup-step-sample')).toHaveAttribute('aria-current', 'step')
    // the listening model gets ready beside every step and never holds one up
    await expect(page.getByTestId('model-line')).toBeVisible()
    await page.getByTestId('demo-skip').click()
    await page.getByTestId('demo-next').click()
    if (MAC) {
      await expect(page.getByRole('heading', { name: 'Get your Mac ready' })).toBeFocused() // a screen reader starts at the new step
      await expect(page.getByTestId('perm-folder')).toContainText('Documents › Reel Studio')
      await expect(page.getByTestId('perm-notifications')).toHaveAttribute('data-state', 'todo') // one card at a time
      // The status poll re-checks every 1.5 s; none of those checks may touch the folder before Allow.
      await page.waitForTimeout(3200)
      expect(existsSync(d.root)).toBe(false)

      await page.getByTestId('perm-folder-allow').click()
      await expect(page.getByTestId('perm-folder')).toHaveAttribute('data-state', 'allowed')
      expect(existsSync(join(d.root, 'Projects'))).toBe(true)
      await page.getByTestId('perm-notifications-allow').click()
      await expect(page.getByTestId('perm-notifications')).toHaveAttribute('data-state', 'allowed')
      expect(await opened(app)).toEqual([]) // nothing was refused, so System Settings never opened
    }

    await expect(page.getByRole('heading', { name: 'Connect your AI editor' })).toBeVisible()
    await expect(page.getByTestId('setup-step-ai')).toHaveAttribute('aria-current', 'step')
    await page.getByTestId('skip').click()
    await page.getByTestId('share-no').click()

    await expect(page.getByRole('heading', { name: 'Reels' })).toBeVisible()
    await expect(page.getByTestId('reels-empty')).toContainText('Drop a video of you talking anywhere in this window, or start with an idea.')
    await expect(page.getByTestId('sample-card')).toBeVisible()
    const settings = JSON.parse(readFileSync(join(d.userData, 'settings.json'), 'utf8'))
    expect(settings.firstRunDone).toBe(true)
    // asked once, nothing preselected: Don't share stores exactly that, and nothing is on
    expect(settings.sharing).toMatchObject({ asked: true, on: false })
    expect(settings.notifications).toBe(MAC ? true : null)
    expect(existsSync(join(d.root, 'Projects'))).toBe(true)
  } finally {
    await app.close()
  }
})

test('a "no" from the Mac says what to do, and the card updates once it is allowed', async () => {
  test.skip(!MAC, 'the Your Mac step is macOS only')
  const d = fresh('denied')
  const { app, page } = await launch({ ...d.env, REELSTUDIO_TEST_PERMISSIONS: 'folder=denied,notifications=failed' })
  try {
    await page.getByTestId('get-started').click()
    await page.getByTestId('demo-skip').click()
    await page.getByTestId('demo-next').click()

    // The folder: the "no" opens Files and Folders, and the helper names the switch.
    await page.getByTestId('perm-folder-allow').click()
    await expect(page.getByTestId('perm-folder-problem')).toHaveText('Your Mac said no. Press Allow to turn it on in System Settings.')
    await expect(page.getByTestId('perm-folder-choose')).toBeVisible()
    await expect.poll(() => opened(app)).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'])
    const folder = await helperWindow(app, 'Set up Files and Folders')
    await expect(folder.locator('header')).toHaveText('↑ Turn on Documents Folder under Reel Studio')
    await expect(folder.locator('#done')).toHaveCount(0) // it closes by itself once the folder can be used

    // The person turns it on in System Settings: the helper sees it within a second, closes itself, and the
    // folder is made. Nothing else to click.
    await app.evaluate(() => {
      delete (globalThis as { __reelPermFakes?: { folder?: string } }).__reelPermFakes!.folder
    })
    await expect.poll(() => app.windows().length, { timeout: 5000 }).toBe(1)
    await expect(page.getByTestId('perm-folder')).toHaveAttribute('data-state', 'allowed', { timeout: 5000 })
    expect(existsSync(join(d.root, 'Projects'))).toBe(true)
    await expect(page.getByTestId('perm-folder-problem')).toHaveCount(0)

    // Notifications open next: macOS said no, so its page opens with a helper that has Done (Reel Studio cannot read it).
    await page.getByTestId('perm-notifications-allow').click()
    await expect(page.getByTestId('perm-notifications-problem')).toHaveText('Your Mac said no. Press Allow to turn it on in System Settings.')
    await expect.poll(async () => (await opened(app))[1]).toBe('x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=dev.reelstudio.app')
    const notes = await helperWindow(app, 'Set up Notifications')
    await expect(notes.locator('header')).toHaveText('↑ Turn on Allow notifications')
    await notes.locator('#done').click()
    await expect.poll(() => app.windows().length).toBe(1)
    // Notifications are optional: still off, and setup goes on.
    await page.getByTestId('perm-notifications-skip').click()
    await expect(page.getByTestId('perm-notifications')).toHaveAttribute('data-state', 'skipped')
    await expect(page.getByRole('heading', { name: 'Connect your AI editor' })).toBeVisible()
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
    expect(existsSync(join(d.root, 'Projects'))).toBe(true) // made at start, the way it always was
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
