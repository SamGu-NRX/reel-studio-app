import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun, newReel, makeReel } from './helpers'

test.skip(process.platform !== 'darwin', 'The fake drive folders follow the macOS layout; the native Windows flow runs on a Windows host.')

async function launchWithHome() {
  const dir = mkdtempSync(join(BASE, 'cloud-'))
  const home = join(dir, 'home')
  mkdirSync(home)
  const { app, page } = await launch({ REELSTUDIO_PHONE_HOST: '127.0.0.1', REELSTUDIO_USER_DATA: join(dir, 'data'), REELSTUDIO_ROOT: join(dir, 'Reel Studio') })
  await app.evaluate(({ app }, folder) => app.setPath('home', folder), home)
  return { app, page, home, iCloud: join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') }
}

/** Exports a reel and returns the exported file. */
async function exportReel(page: Page): Promise<string> {
  await passFirstRun(page)
  await page.getByTestId('new-video').click()
  await page.getByTestId('file-input').setInputFiles([makeMedia().video])
  await expect(page.getByTestId('player')).toBeVisible()
  await page.getByTestId('export').click()
  await expect(page.getByTestId('export-saved')).toBeVisible()
  const file = await page.getByTestId('export-name').getAttribute('title')
  if (!file) throw new Error('The export dialog has no video path')
  return file
}

async function openCloudWay(page: Page) {
  await page.getByTestId('send-to-phone').click()
  await page.getByTestId('phone-cant').click()
  return page.getByTestId('phone-cloud')
}

test('fails if the drive way loses its web links, saves the wrong export or to the wrong drive, or crowds the export dialog', async () => {
  const { app, page, home, iCloud } = await launchWithHome()
  try {
    await app.evaluate(({ app }, folder) => app.setPath('home', folder), home)
    await passFirstRun(page)
    await makeReel(page, media.video)
    await page.getByTestId('export').click()
    await expect(page.getByTestId('export-saved')).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByTestId('send-to-phone').click()
    await page.getByTestId('phone-cant').click()
    await page.locator('.phone-fallbacks .phone-way').nth(1).scrollIntoViewIfNeeded()
    await page.getByTestId('phone-back').click()
    // the export dialog's own saves (Share in the title bar has the same buttons, behind the dialog)
    const dialog = page.getByTestId('export-dialog')
    const save = dialog.getByRole('button', { name: 'Save to iCloud Drive', exact: true })
    await expect(save).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByRole('button', { name: 'Save to Google Drive · Personal', exact: true })).toBeVisible({ timeout: 5000 })
    await expect(dialog.getByRole('button', { name: 'Save to Google Drive · Work', exact: true })).toBeVisible({ timeout: 5000 })
    await save.focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('status')).toContainText('Saved to iCloud Drive')
    const saved = join(drive, 'Reel Studio')
    const files = readdirSync(saved)
    expect(files).toHaveLength(1)
    const exportFile = await page.getByTestId('export-name').getAttribute('title')
    if (!exportFile) throw new Error('The export dialog has no video path')
    expect(readFileSync(join(saved, files[0]))).toEqual(readFileSync(exportFile))
    await page.getByRole('button', { name: 'Show in Finder', exact: true }).last().focus()
    await page.keyboard.press('Enter')
    await page.setViewportSize({ width: 1440, height: 900 })
    await dialog.getByRole('button', { name: 'Save to Google Drive · Work', exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('status')).toContainText('Saved to Google Drive · Work')
    const workFiles = readdirSync(join(work, 'Reel Studio'))
    expect(workFiles).toHaveLength(1)
    expect(readFileSync(join(work, 'Reel Studio', workFiles[0]))).toEqual(readFileSync(exported))
    expect(readdirSync(personal)).toEqual([])
  } finally {
    await app.close()
  }
})

test('fails if quitting during a save leaves an empty or temporary file in the drive', async () => {
  const { app, page, iCloud } = await launchWithHome()
  mkdirSync(iCloud, { recursive: true })
  const folder = join(iCloud, 'Reel Studio')
  try {
    const exported = await exportReel(page)
    // A slow drive: the copy finishes, then the drive takes a while to report it.
    await app.evaluate(() => {
      const fs = process.getBuiltinModule('node:fs')
      const copyFile = fs.promises.copyFile
      fs.promises.copyFile = async (...args: Parameters<typeof copyFile>) => {
        await copyFile(...args)
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    })
    await openCloudWay(page)
    await page.getByRole('button', { name: 'Save to iCloud Drive', exact: true }).click()
    await expect.poll(() => existsSync(folder) && readdirSync(folder).some((name) => name.endsWith('.tmp'))).toBe(true)
    await app.close()
    const left = readdirSync(folder)
    expect(left.filter((name) => name.endsWith('.tmp'))).toEqual([])
    for (const name of left) expect(readFileSync(join(folder, name))).toEqual(readFileSync(exported))
  } finally {
    await app.close().catch(() => {})
  }
})
