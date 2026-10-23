// Switching between versions on the Reel screen must not decode a cover it has already shown. Each switch
// puts up a new <video> layer, and a 1080x1920 cover decoded again on every switch kept about 1.9 MiB of renderer
// memory per switch. The decodes are counted in a Chromium trace while switching back and forth. Each version's
// line in the notes plays it.
//
// Run: npx playwright test e2e/player-covers.spec.ts (after npm run build).
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun } from './helpers'

async function pick(page: Page, n: number): Promise<void> {
  await page.getByTestId(`log-play-${n}`).click()
  await page.waitForFunction((n) => {
    const v = document.querySelector<HTMLVideoElement>('video.layer:not(.loading):not([aria-hidden])')
    const at = new RegExp(`[\\\\/]versions[\\\\/]v${n}[\\\\/]`)
    return !!v && at.test(decodeURIComponent(v.currentSrc)) && at.test(decodeURIComponent(v.poster))
  }, n)
  // Lets the cover of this switch paint before the next one replaces it.
  await page.waitForTimeout(500)
}

async function coverDecodes(app: ElectronApplication, during: () => Promise<void>): Promise<number> {
  await app.evaluate(({ contentTracing }) => contentTracing.startRecording({ included_categories: ['disabled-by-default-devtools.timeline'] }))
  await during()
  const file = join(BASE, 'player-trace.json')
  await app.evaluate(({ contentTracing }, file) => contentTracing.stopRecording(file), file)
  // one "Decode Image" per decoded image; this Electron's trace gives it no image type, and the probe image is a PNG too
  const events: { name: string; ph: string }[] = JSON.parse(readFileSync(file, 'utf8')).traceEvents
  return events.filter((e) => e.name === 'Decode Image' && e.ph !== 'E').length
}

test('switching back to a version does not decode its cover again', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch()
  await passFirstRun(page)
  await makeReel(page, media.video)
  await page.getByTestId('edit-myself').click()
  await page.getByTestId('mirror-on').check()
  await page.getByTestId('make-version').click()
  await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 5 * 60_000 })

  await pick(page, 1)
  await pick(page, 2)
  const decodes = await coverDecodes(app, async () => {
    for (const n of [1, 2, 1, 2]) await pick(page, n)
    // one image no one has shown yet, decoded the way the player decodes a cover: the trace must count it, so a
    // trace that sees no decodes at all can't pass this test
    await page.evaluate(async () => {
      const c = document.createElement('canvas')
      Object.assign(c, { width: 1080, height: 1920 })
      c.getContext('2d')!.fillRect(0, 0, 10, 10)
      const img = new Image()
      img.src = c.toDataURL('image/png') // the page's CSP takes data: images, not blob:
      await img.decode()
    })
  })
  expect(decodes).toBe(1)
  await app.close()
})
