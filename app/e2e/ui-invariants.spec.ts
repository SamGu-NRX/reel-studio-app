import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { APP_DIR, BASE, SHOTS, makeMedia, makeReel, passFirstRun } from './helpers'

const FIXED_SEEDS = [11, 29, 47, 83, 101, 149, 211, 307, 401, 503]
type Action = 'play' | 'pause' | 'seek' | 'holdOriginal' | 'point' | 'compare' | 'edit' | 'switchVersion' | 'collapseSidebar' | 'resize' | 'escape'
type Invariant = 'a' | 'b' | 'c' | 'd' | 'e' | 'f'
type Violation = { invariant: Invariant; detail: string }
type Step = { step: number; action: Action; result: string }
type RecordedViolation = Violation & { seed: number; step: number; action: Action }
// The Reel screen has one layout (ux-foundation-b.md section 5): no zoomed view and no Versions panel. Versions are
// played and compared from their lines in the notes; the timeline seeks.
const ACTIONS: Action[] = ['play', 'pause', 'seek', 'holdOriginal', 'point', 'compare', 'edit', 'switchVersion', 'collapseSidebar', 'resize', 'escape']
const MACROS: Action[][] = [
  // Sam's bug 5: the moment chip disagreed with the playhead after play, scrub, pause and point
  ['play', 'seek', 'play', 'pause', 'point', 'escape', 'pause'],
  ['play', 'seek', 'pause', 'point'],
  ['seek', 'play', 'pause', 'point', 'escape'],
  ['switchVersion', 'compare', 'escape'],
  ['edit', 'edit', 'collapseSidebar', 'resize']
]

function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = Math.imul(1664525, state) + 1013904223
    return (state >>> 0) / 0x100000000
  }
}

/** The app on an isolated profile. Whatever runs the suite decides how its windows show (helpers.ts launch). */
async function launchIsolated(mine: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete env[key]
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
    FAKE_ENGINE_SLOW: '3',
    REELSTUDIO_MOCK_NOTE: '800'
  })
  mkdirSync(mine, { recursive: true })
  const app = await electron.launch({ args: [APP_DIR], cwd: APP_DIR, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return { app, page }
  } catch (error) {
    await app.close().catch(() => {})
    throw error
  }
}

async function scope(page: Page): Promise<Locator> {
  return page.locator('body')
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
  // a control can go between the check above and this read (Pause turns into Play when the video ends): a short
  // wait, then it counts as absent, instead of the 30 s default that fails the whole walk
  const box = await item.boundingBox({ timeout: 2000 }).catch(() => null)
  if (!box) return 'skipped: no bounds'
  const cover = await item.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return top && el.contains(top) ? null : `${top?.tagName}.${top?.getAttribute('class') ?? ''}`
  }, undefined, { timeout: 2000 }).catch(() => 'gone')
  if (cover === 'gone') return 'skipped: no bounds'
  await item.page().mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  return cover ? `blocked by ${cover}` : 'clicked'
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const root = document.body
    const main = root.querySelector<HTMLVideoElement>('[data-testid="player"]')
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
    const modalSelector = '[aria-modal="true"], .modal-backdrop'
    for (const control of Array.from(document.querySelectorAll('button, a[href]'))) {
      if (!visible(control) || (control as HTMLButtonElement).disabled || control.getAttribute('aria-disabled') === 'true') continue
      const rect = control.getBoundingClientRect()
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      if (top && control.contains(top)) continue
      const allowedModal = top?.closest(modalSelector)
      if (allowedModal && !allowedModal.contains(control) && visible(allowedModal)) continue
      if (control.closest('[inert]')) continue
      const detail = `control=${control.getAttribute('aria-label') ?? control.textContent?.trim()} testid=${control.getAttribute('data-testid')} coveredBy=${top?.tagName}.${top?.getAttribute('class') ?? ''}`
      issues.push({ invariant: 'd', detail })
      if (control.closest('.tb-actions')) issues.push({ invariant: 'e', detail })
    }
    const parse = (text: string | null | undefined) => {
      const match = text?.match(/(\d+):([0-5]\d)/)
      return match ? Number(match[1]) * 60 + Number(match[2]) : null
    }
    const range = root.querySelector<HTMLInputElement>('input[aria-label="Position in the reel"]')
    const time = root.querySelector('[data-testid="time"]')
    const readout = parse(time?.textContent)
    // the offer, and the moment attached by itself, both show the playhead
    const chips = Array.from(root.querySelectorAll('[data-testid="moment-suggest"], [data-testid="moment-chip"][data-auto]')).filter(visible).map((chip) => parse(chip.textContent))
    const pausedButton = Array.from(root.querySelectorAll('button[aria-label="Play"]')).find(visible)
    if (main && main.readyState >= 2 && !main.seeking) {
      if (range && Math.abs(Number(range.value) - main.currentTime) > 0.25) issues.push({ invariant: 'c', detail: `scrubber=${range.value} video=${main.currentTime.toFixed(3)}` })
      // the transport and the chip both show the whole second the playhead is in (floor), like any video player
      if (readout !== null && (main.currentTime < readout - 0.25 || main.currentTime > readout + 1.25)) issues.push({ invariant: 'c', detail: `readout=${readout} video=${main.currentTime.toFixed(3)}` })
      for (const chip of chips) if (chip !== null && (main.currentTime < chip - 0.25 || main.currentTime > chip + 1.25)) issues.push({ invariant: 'c', detail: `moment=${chip} video=${main.currentTime.toFixed(3)}` })
    }
    return { issues, videos, pausedUI: !!pausedButton, readout, chips }
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
    const timeline = await candidate(root.getByTestId('timeline'))
    if (!timeline) return 'skipped: timeline absent'
    const box = await timeline.boundingBox()
    if (!box) return 'skipped: no bounds'
    const fraction = 0.1 + random() * 0.75
    await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2)
    return `sought fraction=${fraction.toFixed(4)}`
  }
  if (action === 'holdOriginal') {
    const screen = await candidate(root.locator('.phone-screen'))
    if (!screen) return 'skipped: player absent'
    const box = await screen.boundingBox()
    if (!box) return 'skipped: no bounds'
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(400)
    await page.mouse.up()
    return 'held the video for 400ms'
  }
  if (action === 'point') {
    if (!await root.getByTestId('note-input').count()) return 'skipped: no note box'
    if (random() < 0.5) {
      await page.keyboard.press('c')
      return 'pressed C'
    }
    const menu = await click(root.getByTestId('moment-suggest').locator('xpath=following-sibling::button[1]'))
    if (menu !== 'clicked') return menu
    // the menu renders after the click: wait for its item, and close a menu whose item never came, so a walk never
    // leaves it open over the notes
    const item = root.getByTestId('point-at-spot')
    if (!(await item.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false))) {
      await page.keyboard.press('Escape')
      return 'skipped: the menu showed no Point at a spot'
    }
    return click(item)
  }
  if (action === 'compare') {
    if (await root.getByTestId('done-compare').count()) return click(root.getByTestId('done-compare'))
    return click(root.getByTestId(/^compare-\d+$/).last())
  }
  if (action === 'switchVersion') {
    const lines = root.getByTestId(/^log-play-\d+$/)
    const n = await lines.count()
    if (!n) return 'skipped: no version lines'
    return click(lines.nth(Math.floor(random() * n)))
  }
  if (action === 'edit') return click(root.getByTestId('edit-myself'))
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
// Playwright loads this file in the runner and again in each worker, so long-run seeds must come out the same in
// every process: they follow from REELSTUDIO_INVARIANTS_BASE (today's date unless set).
const longBase = Number(process.env.REELSTUDIO_INVARIANTS_BASE ?? new Date().toISOString().slice(0, 10).replace(/-/g, ''))
const longSeeds = (() => {
  const next = rng(longBase)
  return Array.from({ length: 100 }, () => Math.floor(next() * 0xffffffff))
})()
const seeds = explicit ? explicit.split(',').map(Number) : process.env.REELSTUDIO_INVARIANTS_LONG === '1' ? longSeeds : FIXED_SEEDS
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
    const { app, page } = await launchIsolated(join(BASE, `ui-invariants-${seed}-${testInfo.retry}`))
    try {
      await passFirstRun(page)
      // REELSTUDIO_MOCK_NOTE connects the practice editor, so notes make versions and the moment chip exists
      expect((await page.evaluate(() => window.reel.ai.active())).connected).toBe(true)
      await makeReel(page, media.video)
      const slug = await page.evaluate(() => window.reel.projects.list().then((l) => l[0].slug))
      await page.evaluate((s) => window.reel.projects.note(s, 'make the subtitles bigger'), slug)
      await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 120_000 })
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
        if (issues.length) await page.screenshot({ path: join(SHOTS, `invariant-seed-${seed}-step-${log.length}.png`) }).catch(() => {})
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
