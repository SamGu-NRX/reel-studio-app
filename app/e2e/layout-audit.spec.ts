// Layout audit: visits every screen and state at the four window sizes and runs the detectors in
// e2e/layout-audit/detect.ts (text overflow, clipping, sideways scrolling, nested scroll areas, overlap, text
// collisions, small targets, popover placement, imbalance). One test per screen, so each screen passes or fails on
// its own. P1 and P2 findings fail it; P3 is reported only.
//
//   REELSTUDIO_AUDIT_SCREENS=first-run,home   only these screens (names below)
//   REELSTUDIO_AUDIT_SIZES=1100x720,1920x1080 only these sizes
//   REELSTUDIO_AUDIT_OUT=<folder>             where findings.json, FINDINGS.md and the shots go
//                                             (default app/test-results/layout-audit)
//
// Accepted exceptions live in e2e/layout-audit/allowlist.ts, each with a state, a selector and a reason.
import { test, expect, _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APP_DIR, BASE, makeMedia, makeReel, passFirstRun } from './helpers'
import { detectLayout, type RawFinding } from './layout-audit/detect'
import { ALLOW } from './layout-audit/allowlist'
import { OUT, commit, counts, outlinedShot, sourceFor, writeScreen, type Finding, type ScreenResult } from './layout-audit/report'

const ALL_SIZES: [number, number][] = [
  [1100, 720],
  [1280, 820],
  [1512, 982],
  [1920, 1080]
]
const sizeName = ([w, h]: [number, number]): string => `${w}x${h}`
const pick = (env: string | undefined): Set<string> | null => (env ? new Set(env.split(',').map((s) => s.trim()).filter(Boolean)) : null)
const ONLY_SCREENS = pick(process.env.REELSTUDIO_AUDIT_SCREENS)
const ONLY_SIZES = pick(process.env.REELSTUDIO_AUDIT_SIZES)
const SIZES = ALL_SIZES.filter((s) => !ONLY_SIZES || ONLY_SIZES.has(sizeName(s)))
const FAIL_ON = new Set((process.env.REELSTUDIO_AUDIT_FAIL_ON ?? 'P1,P2').split(','))

type Ctx = { app: ElectronApplication; page: Page; media: ReturnType<typeof makeMedia> }
interface State {
  id: string
  /** Gets there from wherever the previous state left the app. */
  enter(ctx: Ctx): Promise<void>
  /** Shows the state is on screen; checked after each resize, and the state is entered again if it went away. */
  ready(page: Page): Locator
  /** The screen's focal object and its column, for the imbalance check. */
  focal?: string
  column?: string
}
interface Screen {
  id: string
  /** fresh: the first run. ready: past the first run, no reels. reel: past the first run, with one reel. */
  profile: 'fresh' | 'ready' | 'reel'
  env?: Record<string, string>
  states: State[]
}

// ---- launching -------------------------------------------------------------------------------------------
// Profiles outside BASE survive Playwright restarting the worker after a failed screen (BASE goes with the worker);
// the cleanup reporter removes REELSTUDIO_E2E_TMP at the end of the run.
const RUN_DIR = join(process.env.REELSTUDIO_E2E_TMP ?? tmpdir(), `layout-audit-${process.ppid}`)

async function launchIn(dir: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  for (const k of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']) delete env[k]
  Object.assign(env, {
    REELSTUDIO_TEST: '1',
    REELSTUDIO_USER_DATA: join(dir, 'user data'),
    REELSTUDIO_ROOT: join(dir, 'Documents', 'Reel Studio'),
    REELENGINE_CACHE: join(dir, 'engine-cache'),
    REELSTUDIO_MODELS_DIR: join(dir, 'models'),
    HF_HUB_CACHE: join(dir, 'hf-cache'),
    REELSTUDIO_MOCK_AI: '1',
    REELSTUDIO_ENGINE_DIR: join(APP_DIR, 'dev', 'fake-engine'),
    FAKE_ENGINE_SLOW: '1',
    REELSTUDIO_MOCK_NOTE: '400',
    ...extra
  })
  mkdirSync(dir, { recursive: true })
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

/** The profile a screen starts from. `reel` is made once per run and reused, since a reel takes a while to make. */
async function profileFor(screen: Screen, media: Ctx['media']): Promise<string> {
  if (screen.profile === 'fresh') return join(RUN_DIR, `fresh-${screen.id}-${Date.now()}`)
  if (screen.profile === 'ready') {
    const dir = join(RUN_DIR, `ready-${screen.id}-${Date.now()}`)
    const { app, page } = await launchIn(dir, screen.env)
    try {
      await passFirstRun(page)
    } finally {
      await app.close()
    }
    return dir
  }
  const dir = join(RUN_DIR, 'reel-profile')
  if (!existsSync(join(dir, '.made'))) {
    const { app, page } = await launchIn(dir, { REELSTUDIO_MOCK_CLAUDE: 'ready' })
    try {
      await passFirstRun(page)
      await makeReel(page, media.video)
    } finally {
      await app.close()
    }
    writeFileSync(join(dir, '.made'), '')
  }
  return dir
}

async function setSize(app: ElectronApplication, page: Page, [w, h]: [number, number]): Promise<void> {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win.isFullScreen()) win.setFullScreen(false)
    win.setContentSize(s.w, s.h)
  }, { w, h })
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight]), { timeout: 5000 }).toEqual([w, h])
  await settle(page)
}

/** Two frames, then until running finite animations end (at most 1.5 s): measure what the person ends up seeing. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)))
    await frame()
    await frame()
    const end = Date.now() + 1500
    while (Date.now() < end) {
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false
        const t = a.effect?.getComputedTiming()
        return !!t && Number.isFinite(t.endTime as number) && (t.endTime as number) < 5000
      })
      if (!running.length) break
      await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => null))), new Promise((r) => setTimeout(r, 300))])
    }
    await frame()
  })
}

// ---- running one screen ----------------------------------------------------------------------------------
async function audit(screen: Screen): Promise<void> {
  const media = makeMedia()
  const dir = await profileFor(screen, media)
  const { app, page } = await launchIn(dir, screen.env)
  const result: ScreenResult = { screen: screen.id, commit: commit(), at: new Date().toISOString(), sizes: SIZES.map(sizeName), states: [], unreached: [], allowed: 0, findings: [] }
  const ctx: Ctx = { app, page, media }
  try {
    for (const state of screen.states) {
      const reached = await test.step(`${screen.id}/${state.id}`, async () => {
        try {
          await setSize(app, page, SIZES[0])
          await state.enter(ctx)
          await expect(state.ready(page)).toBeVisible({ timeout: 30_000 })
        } catch (e) {
          result.unreached.push({ state: state.id, why: String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 200) })
          return false
        }
        result.states.push(state.id)
        for (const size of SIZES) {
          await setSize(app, page, size)
          if (!(await state.ready(page).isVisible())) {
            await state.enter(ctx)
            await expect(state.ready(page)).toBeVisible({ timeout: 15_000 })
            await settle(page)
          }
          const allow = ALLOW.filter((a) => a.states.includes(state.id)).map(({ detector, selector, with: w }) => ({ detector, selector, with: w }))
          const { findings, allowed } = await page.evaluate(detectLayout, { allow, focal: state.focal, column: state.column })
          result.allowed += allowed
          let shot: string | null = null
          if (findings.length) {
            shot = join('shots', `${state.id}@${sizeName(size)}.png`)
            await outlinedShot(page, findings, join(OUT, shot))
          }
          result.findings.push(...findings.map((f: RawFinding): Finding => ({ ...f, screen: screen.id, state: state.id, size: sizeName(size), source: sourceFor(f.hints), shot })))
        }
        return true
      })
      if (!reached) continue
    }
  } finally {
    await app.close().catch(() => {})
    writeScreen(result)
  }
  const failing = result.findings.filter((f) => FAIL_ON.has(f.severity))
  const c = counts(result.findings)
  const summary = `${screen.id}: ${c.P1} P1, ${c.P2} P2, ${c.P3} P3 (see ${join(OUT, 'FINDINGS.md')})\n` + failing.slice(0, 40).map((f) => `  ${f.severity} ${f.state}@${f.size} ${f.detector}: ${f.detail} [${f.selector}]`).join('\n')
  expect(result.unreached, `${screen.id}: states not reached`).toEqual([])
  expect(failing.length, summary).toBe(0)
}

// ---- states ----------------------------------------------------------------------------------------------
const byTestId = (id: string) => (page: Page) => page.getByTestId(id).first()
const click = (id: string) => async ({ page }: Ctx) => {
  await page.getByTestId(id).first().click()
}

const SCREENS: Screen[] = [
  {
    id: 'first-run',
    profile: 'fresh',
    states: [
      { id: 'first-run-welcome', enter: async () => {}, ready: byTestId('get-started'), focal: '.fr-welcome h1', column: '.fr' },
      {
        id: 'first-run-sample-playing',
        enter: click('get-started'),
        ready: byTestId('sample-phone'),
        focal: '[data-testid="sample-phone"]'
      },
      {
        id: 'first-run-editor',
        enter: async ({ page }) => {
          if (await page.getByTestId('demo-skip').isVisible()) await page.getByTestId('demo-skip').click()
          await page.getByTestId('demo-next').click()
        },
        ready: byTestId('ai-picker')
      },
      {
        id: 'first-run-editor-advanced',
        enter: async ({ page }) => {
          if ((await page.getByTestId('ai-advanced').getAttribute('aria-expanded')) !== 'true') await page.getByTestId('ai-advanced').click()
          await page.getByTestId('own-server-toggle').click()
        },
        ready: byTestId('connection-address')
      },
      {
        id: 'first-run-last',
        enter: async ({ page }) => {
          if (await page.getByTestId('connection-cancel').isVisible()) await page.getByTestId('connection-cancel').click()
          await page.getByTestId('not-now').or(page.getByTestId('editor-continue')).click()
        },
        ready: byTestId('planned-stage')
      }
    ]
  }
]

// The nightly's update offer: the app is a dev build at 0.1.2 with the updater off in tests, so its state is sent over
// the same channel main uses (update:state), as the nightly 0.1.3-nightly.20261028.8 would see 20261028.9.
const NIGHTLY = '0.1.3-nightly.20261028.8'
const NEXT_NIGHTLY = '0.1.3-nightly.20261028.9'
async function sendUpdate(app: ElectronApplication, patch: Record<string, unknown>): Promise<void> {
  const state = {
    status: 'available',
    mode: 'page',
    autoCheck: true,
    currentVersion: NIGHTLY,
    availableVersion: NEXT_NIGHTLY,
    downloadedVersion: null,
    releaseNotes: [{ version: NEXT_NIGHTLY, items: ['The update note no longer covers the AI status.', 'Subtitles keep their case.'], totalItems: 2 }],
    olderNotes: 0,
    releases: [],
    releaseUrl: `https://github.com/example/reel-studio-nightly/releases/tag/v${NEXT_NIGHTLY}`,
    downloadPercent: null,
    message: null,
    errorContext: null,
    snoozed: false,
    ...patch
  }
  await app.evaluate(({ BrowserWindow }, st) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', st)
  }, state)
}

SCREENS.push({
  id: 'update',
  profile: 'ready',
  states: [
    {
      id: 'update-offer-page',
      enter: async ({ app, page }) => {
        await page.mouse.move(5, 400)
        if (!(await page.getByTestId('planned-stage').isVisible())) await page.getByTestId('new-reel').click()
        await expect(page.getByTestId('planned-stage')).toBeVisible()
        await sendUpdate(app, {})
      },
      ready: byTestId('update-button')
    },
    {
      id: 'update-popover-open',
      enter: async ({ app, page }) => {
        if (!(await page.getByTestId('update-button').isVisible())) await sendUpdate(app, {})
        // over its icon: the pointer, not Playwright's hover, which refuses a button something else covers
        const box = (await page.getByTestId('update-button').boundingBox())!
        await page.mouse.move(box.x + 18, box.y + box.height / 2)
      },
      ready: (page) => page.locator('[data-testid="update-popover"][data-open="true"]')
    },
    {
      id: 'update-downloading',
      enter: async ({ app, page }) => {
        await page.mouse.move(700, 5)
        await sendUpdate(app, { status: 'downloading', mode: 'install', downloadPercent: 42 })
      },
      ready: byTestId('update-button')
    }
  ]
})

SCREENS.push({
  id: 'sidebar',
  profile: 'ready',
  states: [
    {
      id: 'sidebar-collapsed',
      enter: async ({ page }) => {
        if ((await page.getByTestId('sidebar-toggle').getAttribute('aria-expanded')) !== 'false') await page.getByTestId('sidebar-toggle').click()
      },
      ready: (page) => page.locator('[data-testid="sidebar-toggle"][aria-expanded="false"]')
    }
  ]
})

for (const screen of SCREENS) {
  test(`layout: ${screen.id}`, async () => {
    test.skip(!!ONLY_SCREENS && !ONLY_SCREENS.has(screen.id), 'not in REELSTUDIO_AUDIT_SCREENS')
    test.setTimeout(10 * 60_000)
    await audit(screen)
  })
}
void BASE
