// First run with the REAL engine: the speech model downloads through the UI with real progress.
// Skipped unless REELSTUDIO_E2E_FIRSTRUN=1 and REELSTUDIO_ENGINE_DIR point at the real engine.
// Uses REELENGINE_MODEL (default tiny.en here, ~78 MB) into a fresh, empty models folder.
import { test, expect } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, SHOTS, launch, shot } from './helpers'

test.skip(process.env.REELSTUDIO_E2E_FIRSTRUN !== '1', 'set REELSTUDIO_E2E_FIRSTRUN=1 to run')

test('first run downloads the listening model with progress', async () => {
  test.setTimeout(30 * 60_000)
  mkdirSync(join(SHOTS, 'firstrun'), { recursive: true })
  const models = join(BASE, 'fresh models ü')
  const model = process.env.REELENGINE_MODEL ?? 'tiny.en'
  const { app, page } = await launch({ REELSTUDIO_MODELS_DIR: models, REELENGINE_MODEL: model })
  try {
    const t0 = Date.now()
    // The download starts by itself with the first run; it never holds a step up, so this watches the footer's line,
    // which goes away once the model is here.
    await page.getByTestId('get-started').click()
    await shot(page, 'firstrun/01-download')
    const line = page.getByTestId('model-line')
    const retry = page.getByTestId('model-retry')
    const installed = () => page.evaluate(() => window.reel.model.status().then((s) => s.installed))
    const seen = new Set<number>()
    let retries = 0
    // A dropped connection stops the download and the line says so with Try again, like a person would see it.
    // Click it, as they would; the engine resumes the .part file with an HTTP Range request.
    while (!(await installed())) {
      if (await retry.isVisible()) {
        const why = await page.getByTestId('model-error').innerText().catch(() => '')
        if (++retries > 5) throw new Error(`download stopped ${retries} times: ${why}`)
        console.log(`download stopped (${why}); clicking Try again (retry ${retries})`)
        await shot(page, `firstrun/02-stopped-${retries}`)
        await retry.click()
        await page.waitForTimeout(2000)
      }
      const m = /(\d+) of (\d+) MB/.exec((await line.innerText().catch(() => '')) || '')
      if (m && Number(m[2]) > 0) seen.add(Math.round((Number(m[1]) * 100) / Number(m[2])))
      if (seen.size === 3) await shot(page, 'firstrun/02-progress')
      if (Date.now() - t0 > 25 * 60_000) throw new Error('download took over 25 minutes')
      await page.waitForTimeout(300)
    }
    const secs = Math.round((Date.now() - t0) / 1000)
    const pcts = [...seen].sort((a, b) => a - b)
    console.log(`model ${model} downloaded in ${secs}s (${retries} resumed after a stop), progress seen: ${pcts.join(',')}`)
    expect(pcts.length, 'saw the progress move').toBeGreaterThan(2)
    expect(readdirSync(join(models, model))).toEqual(expect.arrayContaining(['model.bin', 'config.json']))
    expect(existsSync(join(models, model, 'model.bin.part'))).toBe(false)
    await expect(line).toHaveCount(0)
    await shot(page, 'firstrun/03-ready')
  } finally {
    await app.close()
  }
})
