import { test, expect } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun } from './helpers'
import { basename } from 'node:path'

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
    await makeReel(page, media.video)
    await expect(page.getByTestId('share')).toBeEnabled({ timeout: 10 * 60_000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByTestId('share').click()
    const pop = page.getByTestId('share-pop')
    const save = pop.getByRole('button', { name: /^Save to iCloud Drive\b/ })
    await expect(save).toBeVisible({ timeout: 5000 })
    await expect(pop.getByRole('button', { name: /^Save to Google Drive \(Personal\)/ })).toBeVisible()
    await expect(pop.getByRole('button', { name: /^Save to Google Drive \(Work\)/ })).toBeVisible()
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
    await pop.getByRole('button', { name: /^Save to Google Drive \(Work\)/ }).focus()
    await page.keyboard.press('Enter')
    await expect(pop).toContainText('Saved to Google Drive (Work)')
    const workFiles = readdirSync(join(work, 'Reel Studio'))
    expect(workFiles).toHaveLength(1)
    expect(readFileSync(join(work, 'Reel Studio', workFiles[0]))).toEqual(readFileSync(exportFile))
    expect(readdirSync(personal)).toEqual([])

    // A drive Reel Studio can't write to: the line says so, in words, and nothing is left behind.
    chmodSync(personal, 0o500)
    try {
      await pop.getByRole('button', { name: /^Save to Google Drive \(Personal\)/ }).click()
      await expect(pop.getByRole('alert')).toContainText("Reel Studio isn't allowed to write to Google Drive.")
      expect(readdirSync(personal)).toEqual([])
    } finally {
      chmodSync(personal, 0o700)
    }
  } finally {
    await app.close()
  }
})

test("fails if Send to my phone's drive way loses its web links, names two Google Drives alike, or doesn't say where the video turns up", async () => {
  test.skip(process.platform !== 'darwin', 'The fake drive folders follow the macOS layout; the native Windows flow runs on a Windows host.')
  const dir = mkdtempSync(join(BASE, 'cloud-'))
  const home = join(dir, 'home')
  mkdirSync(home, { recursive: true })
  const { app, page } = await launch({ REELSTUDIO_PHONE_HOST: '127.0.0.1', REELSTUDIO_USER_DATA: join(dir, 'data'), REELSTUDIO_ROOT: join(dir, 'Reel Studio') })
  const cloudWay = async () => {
    await page.getByTestId('share').click()
    await page.getByTestId('share-phone').click()
    await page.getByTestId('phone-cant').click()
    return page.getByTestId('cloud-save')
  }
  try {
    await app.evaluate(({ app }, folder) => app.setPath('home', folder), home)
    await passFirstRun(page)
    await makeReel(page, makeMedia().video)
    await expect(page.getByTestId('share')).toBeEnabled({ timeout: 10 * 60_000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })

    // no drive app on this computer: the drive websites are still offered
    let cloud = await cloudWay()
    await expect(cloud.getByTestId('phone-icloud')).toHaveAttribute('href', 'https://www.icloud.com/iclouddrive/')
    await expect(cloud.getByTestId('phone-gdrive')).toHaveAttribute('href', 'https://drive.google.com/drive/my-drive')
    await expect(cloud.getByRole('button', { name: /^Save to / })).toHaveCount(0)

    const iCloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
    mkdirSync(iCloud, { recursive: true })
    mkdirSync(join(home, 'Library', 'CloudStorage', 'GoogleDrive-zoe.m@example.com', 'My Drive'), { recursive: true })
    mkdirSync(join(home, 'Library', 'CloudStorage', 'GoogleDrive-studio@example.org', 'My Drive'), { recursive: true })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('share-pop')).toBeHidden()
    cloud = await cloudWay()
    await expect(cloud.getByRole('button', { name: /^Save to / })).toHaveText(['Save to iCloud Drive', 'Save to Google Drive (studio)', 'Save to Google Drive (zoe.m)'])
    await expect(cloud.getByTestId('phone-icloud')).toHaveCount(0)

    await cloud.getByRole('button', { name: 'Save to iCloud Drive', exact: true }).focus()
    await page.keyboard.press('Enter')
    const status = cloud.getByTestId('cloud-status')
    await expect(status).toContainText('Saved to iCloud Drive. It shows up on your phone once your drive finishes syncing.')
    await expect(status).toContainText('Files app, then iCloud Drive › Reel Studio')
    const exports = join(dir, 'Reel Studio', 'Library', 'Exports')
    const exported = readdirSync(exports).filter((f) => f.endsWith('.mp4'))
    expect(readdirSync(join(iCloud, 'Reel Studio'))).toEqual([basename(exported[0])])
  } finally {
    await app.close()
  }
})
