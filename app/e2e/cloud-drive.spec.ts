import { test, expect } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun } from './helpers'

test('fails if cloud save copies the wrong export, uses the wrong drive, or fails without saying why', async () => {
  test.skip(process.platform !== 'darwin', 'The native Windows flow runs on a Windows host.')
  const dir = mkdtempSync(join(BASE, 'cloud-'))
  const home = join(dir, 'home')
  const drive = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  mkdirSync(drive, { recursive: true })
  const personal = join(home, 'Library', 'CloudStorage', 'GoogleDrive-Personal', 'My Drive')
  const work = join(home, 'Library', 'CloudStorage', 'GoogleDrive-Work', 'My Drive')
  mkdirSync(personal, { recursive: true })
  mkdirSync(work, { recursive: true })
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_PHONE_HOST: '127.0.0.1', REELSTUDIO_USER_DATA: join(dir, 'data'), REELSTUDIO_ROOT: join(dir, 'Reel Studio') })
  try {
    await app.evaluate(({ app }, folder) => app.setPath('home', folder), home)
    await passFirstRun(page)
    await page.getByTestId('new-video').click()
    await page.getByTestId('file-input').setInputFiles([media.video])
    await expect(page.getByTestId('share')).toBeEnabled({ timeout: 10 * 60_000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByTestId('share').click()
    const pop = page.getByTestId('share-pop')
    const save = pop.getByRole('button', { name: /^Save to iCloud Drive\b/ })
    await expect(save).toBeVisible({ timeout: 5000 })
    await expect(pop.getByRole('button', { name: /^Save to Google Drive · Personal\b/ })).toBeVisible()
    await expect(pop.getByRole('button', { name: /^Save to Google Drive · Work\b/ })).toBeVisible()
    await save.focus()
    await page.keyboard.press('Enter')
    await expect(pop).toContainText('Saved to iCloud Drive')
    const saved = join(drive, 'Reel Studio')
    const files = readdirSync(saved)
    expect(files).toHaveLength(1)
    const exports = join(dir, 'Reel Studio', 'Library', 'Exports')
    const exported = readdirSync(exports).filter((f) => f.endsWith('.mp4'))
    expect(exported).toHaveLength(1)
    const exportFile = join(exports, exported[0])
    expect(readFileSync(join(saved, files[0]))).toEqual(readFileSync(exportFile))
    await pop.getByRole('button', { name: 'Show in Finder', exact: true }).first().focus()
    await page.keyboard.press('Enter')
    await page.setViewportSize({ width: 1440, height: 900 })
    await pop.getByRole('button', { name: /^Save to Google Drive · Work\b/ }).focus()
    await page.keyboard.press('Enter')
    await expect(pop).toContainText('Saved to Google Drive · Work')
    const workFiles = readdirSync(join(work, 'Reel Studio'))
    expect(workFiles).toHaveLength(1)
    expect(readFileSync(join(work, 'Reel Studio', workFiles[0]))).toEqual(readFileSync(exportFile))
    expect(readdirSync(personal)).toEqual([])

    // A drive Reel Studio can't write to: the line says so, in words, and nothing is left behind.
    chmodSync(personal, 0o500)
    try {
      await pop.getByRole('button', { name: /^Save to Google Drive · Personal\b/ }).click()
      await expect(pop.getByRole('alert')).toContainText("Reel Studio isn't allowed to write to Google Drive.")
      expect(readdirSync(personal)).toEqual([])
    } finally {
      chmodSync(personal, 0o700)
    }
  } finally {
    await app.close()
  }
})
