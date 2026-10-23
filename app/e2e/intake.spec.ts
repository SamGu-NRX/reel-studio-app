import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_DIR, BASE, dropFiles, launch, makeMedia, passFirstRun, passSample } from './helpers'

const media = makeMedia()
function profile() {
  const dir = mkdtempSync(join(BASE, 'intake-'))
  return { REELSTUDIO_ROOT: join(dir, 'Reel Studio'), REELSTUDIO_USER_DATA: join(dir, 'data') }
}

for (const source of ['paste', 'open-file before ready', 'second-instance argv']) {
  test(`fails if ${source} does not start a reel`, async () => {
    const env = profile()
    let opened
    if (source === 'open-file before ready') {
      const bootstrap = join(BASE, 'open-file.cjs')
      writeFileSync(bootstrap, `
        const { app } = require('electron')
        app.on('will-finish-launching', () => {
          if (app.isReady()) throw new Error('Expected open-file before ready')
          app.emit('open-file', { preventDefault() {} }, ${JSON.stringify(media.video)})
        })
      `)
      const launchEnv: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) if (value !== undefined) launchEnv[key] = value
      Object.assign(launchEnv, env, { REELSTUDIO_TEST: '1', REELSTUDIO_MOCK_AI: '1',
        REELSTUDIO_ENGINE_DIR: join(APP_DIR, 'dev', 'fake-engine'),
        REELSTUDIO_MODELS_DIR: join(BASE, 'models'), FAKE_ENGINE_SLOW: '3'
      })
      delete launchEnv.ELECTRON_RUN_AS_NODE
      const app = await electron.launch({ args: ['-r', bootstrap, APP_DIR], cwd: APP_DIR, env: launchEnv })
      const page = await app.firstWindow()
      await page.setViewportSize({ width: 1280, height: 820 })
      opened = { app, page }
    } else opened = await launch(env)
    const { app, page } = opened
    try {
      if (source === 'open-file before ready') {
        await expect(page.getByTestId('get-started')).toBeVisible()
        expect(await page.evaluate(() => window.reel.projects.list())).toEqual([])
        await passSample(page)
        await page.getByTestId('not-now').click()
      } else await passFirstRun(page)
      if (source === 'paste') {
        // the app's stand-in clipboard under test (main/index.ts testClipboard): the system clipboard is never read or written
        await app.evaluate(({ ClipboardItem }, url) => {
          globalThis.__reelClipboard.items = [new ClipboardItem({ 'electron application/osclipboard;format="public.file-url"': new Blob([url]) })]
        }, pathToFileURL(media.video).href)
        await page.evaluate(() => window.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true })))
      } else if (source === 'second-instance argv') {
        await app.evaluate(({ app }, file) => { app.emit('second-instance', {}, [process.execPath, '.', file], process.cwd()) }, media.video)
      }
      // a file opened with Reel Studio starts a reel at once, like a drop or a paste, and opens it
      await expect(page.getByTestId('log-video')).toBeVisible({ timeout: 8000 })
      // (the first run's own new reel, still waiting for its video, is not this one)
      const projects = (await page.evaluate(() => window.reel.projects.list())).filter((p) => !p.noVideo)
      expect(projects).toHaveLength(1)
      expect(projects[0].title).toBe('My first take')
    } finally {
      await app.close()
    }
  })
}

test('fails if the drop overlay does not say what letting go will do, or a drop does something else', async () => {
  const { app, page } = await launch(profile())
  try {
    await passFirstRun(page)
    const overlay = page.getByTestId('drop-overlay')
    const leave = () => page.evaluate(() => document.querySelector('[data-testid="reels"]')!.dispatchEvent(new DragEvent('dragleave', { bubbles: true })))
    for (const [file, intent, words] of [
      [media.video, 'reel', 'Make a reel'],
      [media.picture, 'library', 'Add to Library'],
      [media.doc, 'refuse', 'That’s a text file, not a video']
    ] as const) {
      await dropFiles(page, 'reels', [file], false)
      await expect(overlay).toHaveAttribute('data-intent', intent)
      await expect(overlay).toContainText(words)
      await leave()
      await expect(overlay).toHaveCount(0)
    }
    // a picture outside a reel goes into the Library; a file Reel Studio can't use is refused and stays where it is
    await dropFiles(page, 'reels', [media.picture])
    await expect(page.getByTestId('toast')).toContainText('Added 1 picture to your Library.')
    await dropFiles(page, 'reels', [media.doc])
    await expect(overlay).toHaveAttribute('role', 'alert')
    await expect(overlay).toContainText('That’s a text file, not a video')
    expect(await page.evaluate(() => window.reel.projects.list())).toEqual([])
  } finally {
    await app.close()
  }
})

declare global {
  var __reelClipboard: { items: Electron.ClipboardItem[] }
}
