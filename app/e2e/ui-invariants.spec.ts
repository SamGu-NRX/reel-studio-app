import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR, BASE, makeMedia, passFirstRun } from './helpers'

const BOOT = '/Users/samgu/Programming Projects/reel-studio-app-wt/redesign-build/tools/hidden-bootstrap.cjs'
const PROOF = '/Users/samgu/Programming Projects/reel-studio-app-wt/redesign-build/logs/hidden-proof.log'
const FIXED_SEEDS = [11, 29, 47, 83, 101, 149, 211, 307, 401, 503]
type Action = 'play' | 'pause' | 'seek' | 'zoomIn' | 'zoomOut' | 'holdOriginal' | 'point' | 'versions' | 'edit' | 'switchVersion' | 'collapseSidebar' | 'resize' | 'escape'

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = Math.imul(1664525, state) + 1013904223
    return (state >>> 0) / 0x100000000
  }
}

async function launchHidden(root: string, userData: string, cache: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  delete env.ELECTRON_RUN_AS_NODE
  delete env.CLIPROXY_API_KEY
  Object.assign(env, {
    REELSTUDIO_TEST: '1',
    REELSTUDIO_USER_DATA: userData,
    REELSTUDIO_ROOT: root,
    REELENGINE_CACHE: cache,
    REELSTUDIO_MODELS_DIR: join(BASE, 'invariant-models'),
    REELSTUDIO_MOCK_AI: '1',
    REELSTUDIO_ENGINE_DIR: join(APP_DIR, 'dev', 'fake-engine'),
    FAKE_ENGINE_SLOW: '3'
  })
  mkdirSync(join(BASE, 'invariant-models'), { recursive: true })
  const app = await electron.launch({ args: ['-r', BOOT, APP_DIR], cwd: APP_DIR, env })
  const pid = app.process().pid
  if (!pid || !existsSync(PROOF) || !readFileSync(PROOF, 'utf8').includes(`loaded pid=${pid} `)) {
    await app.close().catch(() => {})
    throw new Error(`hidden-window preload proof missing for pid ${pid}`)
  }
  const hidden = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((win) => !win.isVisible()))
  if (!hidden) {
    await app.close().catch(() => {})
    throw new Error('Electron opened a visible window during the invariant run')
  }
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function visible(page: Page, testid: string): Promise<boolean> {
  const item = page.getByTestId(testid)
  return (await item.count()) > 0 && await item.isVisible()
}

async function clickIfVisible(page: Page, locator: ReturnType<Page['getByRole']>): Promise<boolean> {
  if ((await locator.count()) === 0 || !(await locator.first().isVisible())) return false
  await locator.first().click()
  return true
}

async function invariants(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = []
    const videos = Array.from(document.querySelectorAll('video'))
    const playing = videos.filter((video) => !video.paused && !video.ended)
    const audible = playing.filter((video) => !video.muted)
    if (playing.length > 1) issues.push(`playing videos=${playing.length}`)
    if (audible.length > 1) issues.push(`audible playing videos=${audible.length}`)

    const visible = (element: Element) => {
      const style = getComputedStyle(element)
      const rect = (element as HTMLElement).getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
    }
    const modal = Array.from(document.querySelectorAll('[role="dialog"], .modal-backdrop')).find(visible) ?? null
    for (const control of Array.from(document.querySelectorAll('button, a'))) {
      if (!(control as HTMLButtonElement).disabled || control.tagName === 'A') {
        if (!visible(control) || (modal && !modal.contains(control))) continue
        const rect = (control as HTMLElement).getBoundingClientRect()
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (!top || !(top === control || control.contains(top))) issues.push(`covered control ${control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 40) ?? control.tagName}`)
      }
    }

    const titleActions = document.querySelector('[data-testid="titlebar-actions"]')
    if (titleActions && visible(titleActions)) {
      for (const control of Array.from(titleActions.querySelectorAll('button, a'))) {
        if (!visible(control) || (control as HTMLButtonElement).disabled) continue
        const rect = (control as HTMLElement).getBoundingClientRect()
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        if (!top || !(top === control || control.contains(top))) issues.push(`covered title-bar action ${control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 40)}`)
      }
    }

    const active = playing[0]
    if (active) {
      const current = active.currentTime
      const range = document.querySelector('input[aria-label="Position in the video"], input[aria-label="Time in your reel"]') as HTMLInputElement | null
      if (range && Math.abs(Number(range.value) - current) > 0.25) issues.push(`scrubber=${range.value} current=${current.toFixed(2)}`)
      const zoomReadout = document.querySelector('.zoom .tc')?.textContent?.match(/\d+:\d+/)?.[0]
      const time = zoomReadout ?? document.querySelector('.scrub-time')?.textContent
      if (time) {
        const shown = Number(time.split(':')[0]) * 60 + Number(time.split(':')[1])
        const expected = Math.floor(zoomReadout ? current : active.duration - current)
        if (Number.isFinite(shown) && Math.abs(shown - expected) > 0.25) issues.push(`readout=${shown} expected=${expected}`)
      }
      const chip = document.querySelector('[data-testid="moment-suggest"]')?.textContent
      if (chip) {
        const match = chip.match(/\d+:\d+/)
        if (match) {
          const shown = Number(match[0].split(':')[0]) * 60 + Number(match[0].split(':')[1])
          if (Math.abs(shown - Math.floor(current)) > 0.25) issues.push(`moment=${shown} current=${Math.floor(current)}`)
        }
      }
    }
    return issues
  })
}

async function pausedSnapshot(page: Page): Promise<{ time: number; readouts: string[] } | null> {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'))
    if (videos.some((video) => !video.paused && !video.ended)) return null
    return {
      time: videos[0]?.currentTime ?? 0,
      readouts: Array.from(document.querySelectorAll('.scrub-time, .zoom .tc, [data-testid="moment-suggest"]')).map((node) => node.textContent ?? '')
    }
  })
}

async function check(page: Page, seed: number, log: Action[]): Promise<void> {
  const issues = await invariants(page)
  if (issues.length) throw new Error(`seed ${seed}, action log ${JSON.stringify(log)}: ${issues.join('; ')}`)
  const before = await pausedSnapshot(page)
  if (before) {
    await page.waitForTimeout(400)
    const after = await pausedSnapshot(page)
    if (after && (Math.abs(after.time - before.time) > 0.02 || JSON.stringify(after.readouts) !== JSON.stringify(before.readouts))) {
      throw new Error(`seed ${seed}, action log ${JSON.stringify(log)}: paused state changed from ${JSON.stringify(before)} to ${JSON.stringify(after)}`)
    }
  }
}

async function act(page: Page, app: ElectronApplication, action: Action, random: () => number): Promise<boolean> {
  if (action === 'play') return clickIfVisible(page, page.getByRole('button', { name: 'Play', exact: true }))
  if (action === 'pause') return clickIfVisible(page, page.getByRole('button', { name: 'Pause', exact: true }))
  if (action === 'seek') {
    const range = page.locator('input[aria-label="Position in the video"], input[aria-label="Time in your reel"]').first()
    if (!(await range.count()) || !(await range.isVisible())) return false
    const max = Number(await range.getAttribute('max')) || 1
    await range.fill(String(max * random()))
    return true
  }
  if (action === 'zoomIn') return clickIfVisible(page, page.getByTestId('zoom-in').or(page.getByTestId('zoom-in-player')))
  if (action === 'zoomOut') return clickIfVisible(page, page.getByTestId('unzoom'))
  if (action === 'holdOriginal') {
    const button = page.getByRole('button', { name: 'Hold for original', exact: true }).first()
    if (!(await button.count()) || !(await button.isVisible())) return false
    await button.hover()
    const box = await button.boundingBox()
    if (!box) return false
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(80)
    await page.mouse.up()
    return true
  }
  if (action === 'point') {
    if (await visible(page, 'comment')) return clickIfVisible(page, page.getByTestId('comment'))
    if (await visible(page, 'zoom')) {
      await page.keyboard.press('c')
      return true
    }
    return false
  }
  if (action === 'versions') {
    const button = page.getByTestId('version-switch')
    if (!(await button.count()) || !(await button.isVisible())) return false
    await button.click()
    if (await visible(page, 'version-menu')) await page.keyboard.press('Escape')
    return true
  }
  if (action === 'edit') {
    if (await visible(page, 'drawer')) {
      await page.getByTestId('drawer-close').click().catch(() => page.keyboard.press('Escape'))
      return true
    }
    return clickIfVisible(page, page.getByTestId('edit-myself'))
  }
  if (action === 'switchVersion') {
    const switcher = page.getByTestId('version-switch')
    if (!(await switcher.count()) || !(await switcher.isVisible())) return false
    await switcher.click()
    const item = page.getByTestId(/version-item-/).last()
    if (await item.count() && await item.isVisible()) await item.click()
    else await page.keyboard.press('Escape')
    return true
  }
  if (action === 'collapseSidebar') return clickIfVisible(page, page.getByTestId('sidebar-toggle'))
  if (action === 'resize') {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width: 1100 + Math.floor(random() * 400), height: 720 + Math.floor(random() * 180) })
    return true
  }
  await page.keyboard.press('Escape')
  return true
}

const ACTIONS: Action[] = ['play', 'pause', 'seek', 'zoomIn', 'zoomOut', 'holdOriginal', 'point', 'versions', 'edit', 'switchVersion', 'collapseSidebar', 'resize', 'escape']

test('Reel survives seeded UI invariant walks', async () => {
  test.setTimeout(45 * 60_000)
  const media = makeMedia()
  const mine = join(BASE, 'ui-invariants')
  const root = join(mine, 'Documents', 'Reel Studio')
  const { app, page } = await launchHidden(root, join(mine, 'user data'), join(mine, 'engine-cache'))
  try {
    await passFirstRun(page)
    await page.getByTestId('new-video').click()
    await page.getByTestId('file-input').setInputFiles(media.video)
    await expect(page.getByTestId('player')).toBeVisible({ timeout: 240_000 })
    await expect(page.getByTestId('export')).toBeEnabled({ timeout: 240_000 })
    await page.getByTestId('edit-myself').click()
    await page.getByTestId('tab-cut').click()
    const word = page.locator('.word').first()
    if (await word.count()) await word.click()
    await page.getByTestId('make-version').click()
    await expect(page.getByTestId('version-switch')).toContainText('Version 2', { timeout: 240_000 })
    if (await visible(page, 'drawer')) await page.getByTestId('drawer-close').click()
    await page.evaluate(() => document.querySelectorAll('video').forEach((video) => video.pause()))

    const requested = process.env.REELSTUDIO_INVARIANT_SEEDS?.split(',').map(Number).filter(Number.isFinite)
    const seeds = requested?.length ? requested : process.env.REELSTUDIO_INVARIANTS_LONG ? Array.from({ length: 25 }, () => Math.floor(Math.random() * 0x7fffffff)) : process.env.CI ? FIXED_SEEDS : [FIXED_SEEDS[0]]
    for (const seed of seeds) {
      const random = rng(seed)
      const log: Action[] = []
      const count = 40 + Math.floor(random() * 41)
      for (let i = 0; i < count; i++) {
        const action = ACTIONS[Math.floor(random() * ACTIONS.length)]
        const did = await act(page, app, action, random)
        if (!did) continue
        log.push(action)
        await page.waitForTimeout(80)
        await check(page, seed, log)
        if ((action === 'zoomOut' || action === 'escape') && await visible(page, 'zoom')) {
          throw new Error(`seed ${seed}, action log ${JSON.stringify(log)}: zoomed view remained after ${action}`)
        }
      }
      console.log(`[ui-invariants] seed=${seed} actions=${log.length}`)
    }
  } finally {
    await app.close()
  }
})
