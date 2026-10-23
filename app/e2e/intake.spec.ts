import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_DIR, BASE, launch, makeMedia, passFirstRun, passMacStage, passSample } from './helpers'

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
        await passMacStage(page)
        await page.getByTestId('skip').click()
        await page.getByTestId('share-no').click()
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
      const projects = await page.evaluate(() => window.reel.projects.list())
      expect(projects).toHaveLength(1)
      expect(projects[0].title).toBe('My first take')
    } finally {
      await app.close()
    }
  })
}

declare global {
  var __reelClipboard: { items: Electron.ClipboardItem[] }
}
