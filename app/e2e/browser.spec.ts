// The browser slice end to end: the desktop app (REELSTUDIO_BROWSER=1) serves itself to a separate headless browser on
// this computer, which pairs through the app's one-time link, opens Home, plays and seeks a reel, sends a note with the
// stand-in AI and engine, and watches it become Version 2. Desktop-only actions say so instead of failing quietly.
import { test, expect, chromium, webkit, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, makeMedia, passFirstRun, SHOTS } from './helpers'

const LOCAL_ONLY = (what: string) => `${what} works in the Reel Studio app on this computer.`

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(join(SHOTS, 'browser'), { recursive: true })
  await page.waitForTimeout(300) // past the 200 ms entrance of a toast or banner
  await page.screenshot({ path: join(SHOTS, 'browser', `${name}.png`) })
}

test('a browser on this computer opens Home, plays and seeks a reel, and watches a note become a new version', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_BROWSER: '1', REELSTUDIO_MOCK_CLAUDE: 'ready' })
  // REELSTUDIO_E2E_BROWSER=webkit runs Safari's engine instead of Chromium (`npx playwright install webkit` first)
  const browser = await (process.env.REELSTUDIO_E2E_BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true })
  try {
    // ---- the desktop app makes Version 1 and turns on the stand-in AI editor ----
    await passFirstRun(page)
    await page.getByTestId('new-video').click()
    await page.getByTestId('file-input').setInputFiles([media.video])
    await expect(page.getByTestId('player')).toBeVisible({ timeout: 5 * 60_000 })
    await page.evaluate(() => window.reel.ai.setActive('claude-cli'))

    const pairing = await app.evaluate(() => (globalThis as { __reelPairingUrl?: string }).__reelPairingUrl ?? '')
    expect(pairing).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/#pair=[\w-]{32}$/)
    const origin = new URL(pairing).origin

    // ---- a browser without the link sees the page, and nothing in it ----
    const stranger = await browser.newPage()
    await stranger.goto(`${origin}/`)
    await expect(stranger.getByTestId('connection-banner')).toHaveText(
      'This browser is not signed in. In Reel Studio on this computer, choose File › Open in Browser.'
    )
    await expect(stranger.getByText('Your videos')).toHaveCount(0)
    await snap(stranger, '00-not-signed-in')
    await stranger.close()

    // ---- the link pairs this browser, once ----
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } })
    const web = await ctx.newPage()
    const problems: string[] = []
    web.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    web.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`))
    await web.goto(pairing)
    await expect(web).toHaveURL(`${origin}/`) // the code left the address bar
    expect(await ctx.cookies()).toEqual([]) // nothing that grants access is a cookie (cookies go to every port)
    // the device key cannot be read out of the page, even by its own script
    const exported = await web.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const open = indexedDB.open('reel-browser', 1)
          open.onsuccess = () => {
            const get = open.result.transaction('device').objectStore('device').get('device')
            get.onsuccess = () =>
              crypto.subtle.exportKey('pkcs8', get.result.key).then(
                () => resolve('exported'),
                (e: Error) => resolve(e.name)
              )
          }
        })
    )
    expect(exported).toBe('InvalidAccessError')

    // ---- Home ----
    await expect(web.getByText('Your videos')).toBeVisible()
    await expect(web.getByTestId('project-card')).toHaveCount(1)
    await expect(web.getByTestId('card-status')).toHaveText('Ready · Version 1')
    await snap(web, '01-home')

    // ---- open the reel, play and seek Version 1 ----
    await web.getByTestId('project-card').click()
    const video = web.getByTestId('player')
    await expect(video).toHaveAttribute('src', /^\/media\/[\w-]{43}\/Projects\/my-first-take\/versions\/v1\/export\.mp4\?v=\d+$/)
    const playable = await video.evaluate((v: HTMLVideoElement) => v.canPlayType('video/mp4; codecs="avc1.42E01E"'))
    expect(playable, 'this browser build cannot decode H.264').not.toBe('')
    await video.evaluate(async (v: HTMLVideoElement) => {
      v.muted = true
      await v.play()
    })
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.3)
    const seeked = await video.evaluate(
      (v: HTMLVideoElement) =>
        new Promise<{ at: number; ranges: number }>((resolve) => {
          v.addEventListener('seeked', () => resolve({ at: v.currentTime, ranges: v.seekable.length }), { once: true })
          v.currentTime = 9
        })
    )
    expect(seeked.at).toBeGreaterThanOrEqual(8.9)
    expect(seeked.ranges).toBeGreaterThan(0)
    await video.evaluate((v: HTMLVideoElement) => v.pause())
    await snap(web, '02-reel')

    // ---- what needs the desktop app says so ----
    const toast = web.getByTestId('toast')
    await web.getByTestId('export').click()
    await expect(toast).toHaveText(LOCAL_ONLY('Exporting'))
    await web.getByTestId('edit-myself').click()
    await expect(toast).toHaveText(LOCAL_ONLY('Editing it yourself'))
    await expect(toast.getByRole('button', { name: 'Close' })).toBeVisible() // stays until closed
    await expect(web.locator('.drawer')).toHaveCount(0)
    await snap(web, '03-local-only')
    await web.getByTestId('nav-library').click()
    await expect(web.getByTestId('local-only')).toContainText(LOCAL_ONLY('The Library'))
    await web.getByTestId('nav-home').click()
    await web.getByTestId('project-card').click()

    // ---- a note, watched live until it is Version 2 ----
    await web.getByTestId('note-input').fill('Make the subtitles bigger')
    await web.keyboard.press('Enter')
    const progress = web.getByTestId('note-progress')
    await expect(progress).toContainText('Putting it all together', { timeout: 60_000 })
    await snap(web, '04-note-progress')
    await expect(progress).toHaveCount(0, { timeout: 5 * 60_000 })
    await expect(web.getByTestId('versions')).toContainText('Version 2')
    await expect(video).toHaveAttribute('src', /\/versions\/v2\/export\.mp4\?v=\d+$/)
    await expect(web.getByTestId('bubble-you').last()).toHaveText('Make the subtitles bigger')
    await expect(web.getByTestId('bubble-editor').last()).toContainText('Version 2')
    await snap(web, '05-version-2')

    // Version 1 is still there to play
    await web.getByRole('radio', { name: 'Version 1' }).click()
    await expect(video).toHaveAttribute('src', /\/versions\/v1\/export\.mp4/)

    // ---- the link drops and comes back: the page keeps a half-written note, its focus, and its data ----
    const box = web.getByTestId('note-input')
    await box.fill('Make the music quieter')
    await box.focus()
    const beforeDrop = problems.length
    await app.evaluate(() => (globalThis as { __reelDropBrowsers?: () => void }).__reelDropBrowsers?.())
    const banner = web.getByTestId('connection-banner')
    await expect(banner).toHaveText('Lost the link to Reel Studio on this computer. Reconnecting…')
    await snap(web, '06-reconnecting')
    await expect(banner).toBeEmpty()
    await expect(box).toHaveValue('Make the music quieter')
    await expect(box).toBeFocused()
    await expect(web.getByTestId('versions')).toContainText('Version 2')
    // WebKit logs the socket this test dropped on purpose; that line, and only that one, is expected
    const fromDrop = problems.splice(beforeDrop)
    expect(fromDrop.filter((p) => !/^console: WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/ws' failed/.test(p))).toEqual([])

    // the desktop window sees the same reel
    const desktop = await page.evaluate(async () => {
      const [p] = await window.reel.projects.list()
      return (await window.reel.projects.get(p.slug)).versions.map((v) => v.n)
    })
    expect(desktop).toEqual([1, 2])
    expect(problems).toEqual([])
  } finally {
    await browser.close()
    await app.close()
  }
})
