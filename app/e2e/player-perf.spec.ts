// The Reel player's work, counted rather than timed (notes/perf/player-audit.md, "Continuous checks"), so the
// result does not depend on how fast the machine is. A probe installed before the app loads counts timeline
// writes and cover decodes, the way scripts/perf/player-probe.cjs on fork perf-player counts frames and commits.
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun } from './helpers'

declare global {
  interface Window {
    __perfCount: { pct: number; decodes: string[] }
  }
}

function probe(): void {
  const c = (window.__perfCount = { pct: 0, decodes: [] as string[] })
  const setProperty = CSSStyleDeclaration.prototype.setProperty
  CSSStyleDeclaration.prototype.setProperty = function (this: CSSStyleDeclaration, name: string, ...rest: [string | null, string?]) {
    // the timeline's fill only
    if (name === 'transform' && this === document.querySelector<HTMLElement>('.tl-fill')?.style) c.pct++
    return setProperty.call(this, name, ...rest)
  }
  const decode = HTMLImageElement.prototype.decode
  HTMLImageElement.prototype.decode = function (this: HTMLImageElement) {
    c.decodes.push(this.src)
    return decode.call(this)
  }
}

/** Plays version `n` from its line in the notes. */
async function watch(page: Page, n: number): Promise<void> {
  await page.getByTestId(`log-play-${n}`).click()
  await expect(page.getByTestId('player')).toHaveAttribute('src', new RegExp(`v${n}`), { timeout: 10_000 })
}

test('the player writes the scrub bar at most once per presented frame and decodes each cover once', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const mine = mkdtempSync(join(BASE, 'player-perf-'))
  const { app, page } = await launch({ REELSTUDIO_ROOT: join(mine, 'Reel Studio'), REELSTUDIO_USER_DATA: join(mine, 'user data') })
  try {
    await app.context().addInitScript(probe)
    await page.reload()
    await passFirstRun(page)
    await makeReel(page, media.video, 10 * 60_000)
    // a second version, made by hand
    await page.getByTestId('edit-myself').click()
    await page.getByTestId('tab-captions').click()
    await page.getByTestId('cap-size-big').click()
    await page.getByTestId('make-version').click()
    await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 10 * 60_000 })
    await expect(page.getByTestId('player')).toHaveAttribute('poster', /cover/) // the covers under test exist

    // ---- playback: timeline writes per presented video frame ----
    const presented = () =>
      page.evaluate(
        () =>
          new Promise<number>((done) => {
            const v = document.querySelector<HTMLVideoElement>('[data-testid="player"]')!
            v.requestVideoFrameCallback((_now, m) => done(m.presentedFrames))
          })
      )
    await page.evaluate(async () => {
      const v = document.querySelector<HTMLVideoElement>('[data-testid="player"]')!
      v.muted = true
      v.currentTime = 0
      await v.play()
    })
    const f0 = await presented()
    const w0 = await page.evaluate(() => window.__perfCount.pct)
    await page.waitForTimeout(3000)
    const f1 = await presented()
    const w1 = await page.evaluate(() => window.__perfCount.pct)
    await page.evaluate(() => document.querySelector<HTMLVideoElement>('[data-testid="player"]')!.pause())
    const frames = f1 - f0
    const writes = w1 - w0
    console.log(`timeline writes ${writes} over ${frames} presented frames`)
    expect(frames, 'the video played').toBeGreaterThan(30)
    expect(writes, 'timeline writes per presented frame').toBeLessThanOrEqual(frames)

    // ---- version switches: a cover already seen is never decoded again ----
    await watch(page, 1)
    await watch(page, 2)
    const firstVisits = await page.evaluate(() => window.__perfCount.decodes.length)
    await watch(page, 1)
    await watch(page, 2)
    await watch(page, 1)
    const again = await page.evaluate((from) => window.__perfCount.decodes.slice(from), firstVisits)
    console.log(`cover decodes: ${firstVisits} on first visits, ${again.length} on returns`)
    expect(firstVisits, 'first visits decode their covers').toBeGreaterThan(0)
    expect(again, 'covers decoded again on returning to a seen version').toEqual([])
  } finally {
    await app.close()
  }
})
