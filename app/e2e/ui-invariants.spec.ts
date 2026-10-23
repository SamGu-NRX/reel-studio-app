import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR, BASE, chooseClaudeCode, makeMedia, openSettings, passFirstRun } from './helpers'

const BOOT = '/Users/samgu/Programming Projects/reel-studio-app-wt/redesign-build/tools/hidden-bootstrap.cjs'
const PROOF = '/Users/samgu/Programming Projects/reel-studio-app-wt/redesign-build/logs/hidden-proof.log'
const FIXED_SEEDS = [11, 29, 47, 83, 101, 149, 211, 307, 401, 503]
type Action = 'play' | 'pause' | 'seek' | 'zoomIn' | 'zoomOut' | 'holdOriginal' | 'point' | 'versions' | 'compare' | 'edit' | 'switchVersion' | 'collapseSidebar' | 'resize' | 'escape'
type Invariant = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
type Violation = { invariant: Invariant; detail: string }
type Step = { step: number; action: Action; result: string }
type RecordedViolation = Violation & { seed: number; step: number; action: Action }
const ACTIONS: Action[] = ['play', 'pause', 'seek', 'zoomIn', 'zoomOut', 'holdOriginal', 'point', 'versions', 'compare', 'edit', 'switchVersion', 'collapseSidebar', 'resize', 'escape']
const MACROS: Action[][] = [
  ['play', 'seek', 'zoomIn', 'play', 'pause', 'point', 'zoomOut', 'escape', 'pause'],
  ['play', 'zoomIn', 'zoomOut', 'pause', 'point'],
  ['zoomIn', 'seek', 'play', 'pause', 'point', 'escape'],
  ['versions', 'switchVersion', 'compare', 'escape'],
  ['edit', 'edit', 'collapseSidebar', 'resize']
]

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = Math.imul(1664525, state) + 1013904223
    return (state >>> 0) / 0x100000000
  }
}

async function launchHidden(mine: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  for (const key of ['ELECTRON_RUN_AS_NODE', 'CLIPROXY_API_KEY', 'NODE_OPTIONS']) delete env[key]
  Object.assign(env, {
    REELSTUDIO_TEST: '1',
    REELSTUDIO_USER_DATA: join(mine, 'user data'),
    REELSTUDIO_ROOT: join(mine, 'Documents', 'Reel Studio'),
    REELENGINE_CACHE: join(mine, 'engine-cache'),
    REELSTUDIO_MODELS_DIR: join(mine, 'models'),
    HF_HUB_CACHE: join(mine, 'hf-cache'),
    REELSTUDIO_MOCK_AI: '1',
    REELSTUDIO_MOCK_CLAUDE: 'ready',
    REELSTUDIO_ENGINE_DIR: join(APP_DIR, 'dev', 'fake-engine'),
    FAKE_ENGINE_SLOW: '3'
  })
  mkdirSync(mine, { recursive: true })
  const app = await electron.launch({ args: ['-r', BOOT, APP_DIR], cwd: APP_DIR, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const pid = app.process().pid
    if (!pid || !existsSync(PROOF) || !readFileSync(PROOF, 'utf8').includes(`loaded pid=${pid} `)) throw new Error(`hidden-window preload proof missing for pid ${pid}`)
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((win) => ({ visible: win.isVisible() })))
    if (!windows.length || windows.some((win) => win.visible)) throw new Error(`Electron windows were not hidden: ${JSON.stringify(windows)}`)
    console.log(`[ui-invariants] hidden pid=${pid} proof=loaded windows=${JSON.stringify(windows)}`)
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function scope(page: Page): Promise<Locator> {
  return await page.getByTestId('zoom').count() ? page.getByTestId('zoom') : page.locator('body')
}

async function candidate(locator: Locator): Promise<Locator | null> {
  for (const item of await locator.all()) {
    if (await item.isVisible() && await item.isEnabled() && !await item.evaluate((el) => !!el.closest('[inert]'))) return item
  }
  return null
}

async function click(locator: Locator): Promise<string> {
  const item = await candidate(locator)
  if (!item) return 'skipped: control absent, disabled or inert'
  const box = await item.boundingBox()
  if (!box) return 'skipped: no bounds'
  const cover = await item.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return top && el.contains(top) ? null : `${top?.tagName}.${top?.getAttribute('class') ?? ''}`
  })
  await item.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return cover ? `blocked by ${cover}` : 'clicked'
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="zoom"]') ?? document.body
    const main = root.querySelector<HTMLVideoElement>(root === document.body ? '[data-testid="player"]' : '[data-testid="zoom-video"]')
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height || rect.x + rect.width / 2 < 0 || rect.y + rect.height / 2 < 0 || rect.x + rect.width / 2 >= innerWidth || rect.y + rect.height / 2 >= innerHeight) return false
      for (let parent: Element | null = el; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false
        if (parent !== el && /(hidden|clip|auto|scroll)/.test(style.overflowX + style.overflowY)) {
          const clip = parent.getBoundingClientRect()
          if (rect.x + rect.width / 2 < clip.left || rect.x + rect.width / 2 > clip.right || rect.y + rect.height / 2 < clip.top || rect.y + rect.height / 2 > clip.bottom) return false
        }
      }
      return true
    }
    const videos = Array.from(document.querySelectorAll('video')).map((video) => ({
      id: video.dataset.testid ?? video.className ?? 'video',
      time: video.currentTime, paused: video.paused, muted: video.muted, src: video.currentSrc,
      main: video === main, visible: visible(video)
    }))
    const issues: Violation[] = []
    const playing = videos.filter((video) => !video.paused)
    if (playing.length > 1) issues.push({ invariant: 'a', detail: `playing videos=${JSON.stringify(playing)}` })
    if (playing.filter((video) => !video.muted).length > 1) issues.push({ invariant: 'a', detail: `multiple audible videos=${JSON.stringify(playing)}` })
    const modalSelector = '[aria-modal="true"], .modal-backdrop, .drawer, [data-testid="version-menu"]'
    for (const control of Array.from(document.querySelectorAll('button, a[href]'))) {
      if (!visible(control) || (control as HTMLButtonElement).disabled || control.getAttribute('aria-disabled') === 'true') continue
      const rect = control.getBoundingClientRect()
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      if (top && control.contains(top)) continue
      const allowedModal = top?.closest(modalSelector)
      if (allowedModal && !allowedModal.contains(control) && visible(allowedModal)) continue
      if (control.closest('[inert]') && !control.closest('[data-testid="zoom"]')) continue
      const detail = `control=${control.getAttribute('aria-label') ?? control.textContent?.trim()} testid=${control.getAttribute('data-testid')} coveredBy=${top?.tagName}.${top?.getAttribute('class') ?? ''}`
      issues.push({ invariant: 'd', detail })
      if (control.closest('.tb-actions')) issues.push({ invariant: 'e', detail })
    }
    const parse = (text: string | null | undefined) => {
      const match = text?.match(/(\d+):([0-5]\d)/)
      return match ? Number(match[1]) * 60 + Number(match[2]) : null
    }
    const range = root.querySelector<HTMLInputElement>('input[aria-label="Time in your reel"], input[aria-label="Position in the video"]')
    const time = root.querySelector(root === document.body ? '.scrub-time' : '.ztrans .tc')
    const readout = parse(time?.textContent)
    const chips = Array.from(root.querySelectorAll('[data-testid="moment-suggest"]')).filter(visible).map((chip) => parse(chip.textContent))
    const pausedButton = Array.from(root.querySelectorAll('button[aria-label="Play"]')).find(visible)
    if (main && (root === document.body || (!main.paused && videos.filter((video) => !video.paused).length === 1)) && main.readyState >= 2 && !main.seeking) {
      if (range && Math.abs(Number(range.value) - main.currentTime) > 0.25) issues.push({ invariant: 'c', detail: `scrubber=${range.value} video=${main.currentTime.toFixed(3)}` })
      const expected = root === document.body ? main.duration - main.currentTime : main.currentTime
      // clock() rounds to seconds; Composer floors first. Compare their represented intervals, not invented decimal precision.
      if (readout !== null && Math.max(0, Math.abs(readout - expected) - 0.5) > 0.25) issues.push({ invariant: 'c', detail: `readout=${readout} expected=${expected.toFixed(3)}` })
      for (const chip of chips) if (chip !== null && (main.currentTime < chip - 0.25 || main.currentTime > chip + 1.25)) issues.push({ invariant: 'c', detail: `moment=${chip} video=${main.currentTime.toFixed(3)}` })
    }
    return { issues, videos, pausedUI: !!pausedButton, readout, chips, zoomed: root !== document.body }
  })
}

async function check(page: Page): Promise<Violation[]> {
  const before = await snapshot(page)
  const issues = before.issues
  if (before.pausedUI) {
    await page.waitForTimeout(400)
    const after = await snapshot(page)
    const mainBefore = before.videos.find((video) => video.main)
    const mainAfter = after.videos.find((video) => video.main)
    const backgroundMoved = before.videos.some((video) => {
      const next = after.videos.find((candidate) => candidate.src === video.src && !candidate.main)
      return !video.main && next && Math.abs(video.time - next.time) > 0.02
    })
    if (after.pausedUI && mainBefore && mainAfter && mainBefore.src === mainAfter.src && (backgroundMoved || Math.abs(mainBefore.time - mainAfter.time) > 0.02 || before.readout !== after.readout || JSON.stringify(before.chips) !== JSON.stringify(after.chips))) {
      issues.push({ invariant: 'b', detail: `paused UI advanced: video=${mainBefore.time.toFixed(3)}→${mainAfter.time.toFixed(3)} readout=${before.readout}→${after.readout} chips=${JSON.stringify(before.chips)}→${JSON.stringify(after.chips)} backgroundMoved=${backgroundMoved}` })
    }
  }
  if (issues.some((issue) => issue.invariant === 'c')) {
    await page.waitForTimeout(600)
    const settled = await snapshot(page)
    return [...issues.filter((issue) => issue.invariant !== 'c'), ...settled.issues.filter((issue) => issue.invariant === 'c')]
  }
  return issues
}

async function act(page: Page, app: ElectronApplication, action: Action, random: () => number): Promise<string> {
  const root = await scope(page)
  if (action === 'play' || action === 'pause') return click(root.getByRole('button', { name: action === 'play' ? 'Play' : 'Pause', exact: true }))
  if (action === 'seek') {
    const range = await candidate(root.locator('input[aria-label="Position in the video"], input[aria-label="Time in your reel"]'))
    if (!range) return 'skipped: scrubber absent'
    const fraction = 0.1 + random() * 0.75
    await range.evaluate((element, next) => {
      const input = element as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, (Number(input.max) * next).toFixed(2))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }, fraction)
    return `sought fraction=${fraction.toFixed(4)}`
  }
  if (action === 'zoomIn') return click(root.getByTestId('zoom-in'))
  if (action === 'zoomOut') return click(root.getByTestId('unzoom'))
  if (action === 'holdOriginal') {
    const button = await candidate(root.getByRole('button', { name: 'Hold for original', exact: true }))
    if (!button) return 'skipped: original absent'
    const box = await button.boundingBox()
    if (!box) return 'skipped: no bounds'
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(400)
    await page.mouse.up()
    return 'held original for 400ms'
  }
  if (action === 'point') {
    if (!await root.getByTestId('comment').count()) return 'skipped: point control absent'
    if (random() < 0.5) {
      await page.keyboard.press('c')
      return 'pressed C'
    }
    return click(root.getByTestId('comment'))
  }
  if (action === 'versions' || action === 'switchVersion' || action === 'compare') {
    const menu = root.getByTestId('version-menu')
    if (action === 'compare' && await root.getByTestId('done-compare').count()) return click(root.getByTestId('done-compare'))
    if (action === 'versions' && await menu.count()) return click(menu.getByRole('button', { name: 'Close', exact: true }))
    if (!await menu.count()) {
      const result = await click(root.getByTestId('version-switch').or(root.getByTestId('zoom-version-switch')))
      if (result !== 'clicked') return result
      await menu.waitFor({ state: 'visible', timeout: 2000 })
    }
    if (action === 'versions') return 'opened Versions'
    const n = action === 'compare' ? 2 : random() < 0.5 ? 1 : 2
    const row = menu.getByTestId(`version-item-${n}`)
    const expand = row.locator('button.vr')
    if (await expand.getAttribute('aria-expanded') !== 'true') await click(expand)
    await page.waitForTimeout(250)
    return click(row.getByTestId(action === 'compare' ? `compare-${n}` : `watch-${n}`))
  }
  if (action === 'edit') {
    const drawer = page.getByTestId('drawer')
    return await drawer.count() ? click(drawer.getByTestId('drawer-close')) : click(root.getByTestId('edit-myself'))
  }
  if (action === 'collapseSidebar') return click(root.getByTestId('sidebar-toggle'))
  if (action === 'resize') {
    const size = { width: 1100 + Math.floor(random() * 400), height: 720 + Math.floor(random() * 180) }
    await app.evaluate(({ BrowserWindow }, next) => BrowserWindow.getAllWindows()[0].setContentSize(next.width, next.height), size)
    return `resized ${JSON.stringify(size)}`
  }
  await page.keyboard.press('Escape')
  return 'pressed Escape'
}

const explicit = process.env.REELSTUDIO_INVARIANT_SEEDS
if (explicit && !/^\d+(,\d+)*$/.test(explicit)) throw new Error('REELSTUDIO_INVARIANT_SEEDS must be comma-separated unsigned integers')
const seeds = explicit ? explicit.split(',').map(Number) : process.env.REELSTUDIO_INVARIANTS_LONG === '1' ? Array.from({ length: 100 }, () => Math.floor(Math.random() * 0xffffffff)) : FIXED_SEEDS
const collect = process.env.REELSTUDIO_INVARIANTS_COLLECT === '1'

for (const seed of seeds) {
  test(`Reel UI invariants seed ${seed}`, async ({}, testInfo) => {
    test.setTimeout(240_000)
    const started = Date.now()
    const random = rng(seed)
    const count = 40 + Math.floor(random() * 41)
    const log: Step[] = []
    const recorded: RecordedViolation[] = []
    const media = makeMedia()
    const { app, page } = await launchHidden(join(BASE, `ui-invariants-${seed}-${testInfo.retry}`))
    try {
      await passFirstRun(page)
      await openSettings(page)
      expect(await chooseClaudeCode(page), 'the mock AI must be connected so the moment chip exists').toBe(true)
      await page.getByTestId('nav-home').click()
      await page.getByTestId('new-video').click()
      await page.getByTestId('file-input').setInputFiles(media.video)
      await expect(page.getByTestId('export')).toBeEnabled({ timeout: 120_000 })
      await page.getByTestId('edit-myself').click()
      await page.getByTestId('tab-cut').click()
      await page.locator('.word').first().click()
      await page.getByTestId('make-version').click()
      await expect(page.getByTestId('version-switch')).toContainText('Version 2', { timeout: 120_000 })
      if (await page.getByTestId('drawer').count()) {
        await page.getByTestId('drawer-close').click()
        await expect(page.getByTestId('drawer')).toHaveCount(0)
      }
      await expect(page.getByTestId('moment-suggest')).toBeVisible()
      await click(page.getByTestId('tap-for-sound'))
      const queue: Action[] = [...MACROS[0]]
      while (log.length < count) {
        if (!queue.length) queue.push(...(random() < 0.3 ? MACROS[Math.floor(random() * MACROS.length)] : [ACTIONS[Math.floor(random() * ACTIONS.length)]]))
        const action = queue.shift()!
        const result = await act(page, app, action, random)
        log.push({ step: log.length + 1, action, result })
        await page.waitForTimeout(300)
        const issues = await check(page)
        if ((action === 'zoomOut' && !result.startsWith('skipped') || action === 'escape') && await page.getByTestId('zoom').count()) issues.push({ invariant: 'f', detail: `zoom remained after ${action}; ${result}` })
        for (const issue of issues) {
          recorded.push({ ...issue, seed, step: log.length, action })
          if (!collect) throw new Error(`seed=${seed} step=${log.length} invariant=${issue.invariant} ${issue.detail}\naction log=${JSON.stringify(log)}`)
        }
      }
    } finally {
      await app.close()
      const runtimeMs = Date.now() - started
      const report = { seed, runtimeMs, log, violations: recorded }
      await testInfo.attach('invariant-walk', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
      console.log(`[ui-invariants] ${JSON.stringify(report)}`)
    }
    if (recorded.length) {
      const groups = (['a', 'b', 'c', 'd', 'e', 'f'] as Invariant[]).map((invariant) => {
        const rows = recorded.filter((issue) => issue.invariant === invariant)
        return rows.length ? `${invariant}: ${rows.map((issue) => `seed=${seed} step=${issue.step} action=${issue.action} ${issue.detail}`).join(' | ')}` : null
      }).filter(Boolean)
      throw new Error(`collected ${recorded.length} violations\n${groups.join('\n')}\naction log=${JSON.stringify(log)}`)
    }
  })
}
