// Stand-in model files are pinned through REELSTUDIO_TEST_SPEECH_PINS, so nothing reads the real Hugging Face cache.
import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch } from './helpers'

function fresh(name: string) {
  const dir = mkdtempSync(join(BASE, `listening-${name}-`))
  return { dir, userData: join(dir, 'user data'), models: join(dir, 'models') }
}

/** A Hugging Face cache holding the (stand-in) pinned files, as another app would have left it, and their pins. */
function cachedModel(dir: string): { env: Record<string, string>; files: Record<string, Buffer>; snapshot: string } {
  const files: Record<string, Buffer> = {
    'config.json': Buffer.from('{"model_type": "whisper"}'),
    'model.bin': Buffer.alloc(8 << 20, 3),
    'tokenizer.json': Buffer.from('{"version": "1.0"}'),
    'vocabulary.txt': Buffer.from('a\nb\n')
  }
  const snapshot = join(dir, 'hf', 'models--Systran--faster-whisper-small.en', 'snapshots', 'rev1')
  mkdirSync(snapshot, { recursive: true })
  for (const [n, b] of Object.entries(files)) writeFileSync(join(snapshot, n), b)
  const pins = join(dir, 'pins.json')
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
  writeFileSync(pins, JSON.stringify({ 'small.en': { repo: 'Systran/faster-whisper-small.en', revision: 'rev1', files: Object.entries(files).map(([name, b]) => ({ name, size: b.length, sha256: sha(b) })) } }))
  return { env: { HF_HUB_CACHE: join(dir, 'hf'), REELSTUDIO_TEST_SPEECH_PINS: pins }, files, snapshot }
}

/** The model is looked up the moment the first run starts; its line sits under every setup step. */
async function toStage(page: Page): Promise<void> {
  await page.getByTestId('get-started').click()
}

const line = (page: Page) => page.getByTestId('model-line')
/** The timing check's saved answer, or null before the app has written settings.json. */
const savedCheck = (userData: string) => () => {
  const file = join(userData, 'settings.json')
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).speechCheck ?? null) : null
}

test('a listening model already on this computer is used without a download; the timing check runs unseen', async () => {
  const d = fresh('found')
  const cache = cachedModel(d.dir)
  const { app, page } = await launch({ REELSTUDIO_USER_DATA: d.userData, REELSTUDIO_MODELS_DIR: d.models, ...cache.env })
  try {
    await toStage(page)
    await expect(line(page)).toContainText('Listening model ready')
    await expect(line(page)).toContainText(`Found one already on this ${process.platform === 'darwin' ? 'Mac' : 'PC'}, so nothing to download.`)
    for (const [n, b] of Object.entries(cache.files)) expect(readFileSync(join(d.models, 'small.en', n)).equals(b)).toBe(true)
    expect(existsSync(join(cache.snapshot, 'model.bin'))).toBe(true) // copied, never moved out of the cache

    // The check ran in the background and saved its answer; the line never showed it.
    await expect.poll(savedCheck(d.userData), { timeout: 10_000 }).toMatchObject({ threads: 4 })
    await expect(page.getByTestId('model-check-failed')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('without one it downloads by itself with MB progress while setup goes on, and says what to do when the internet drops', async () => {
  const d = fresh('download')
  const { app, page } = await launch({ REELSTUDIO_USER_DATA: d.userData, REELSTUDIO_MODELS_DIR: d.models, FAKE_ENGINE_DOWNLOAD_STEP: '0.5' })
  try {
    await toStage(page)
    await expect(line(page)).toContainText(/[1-9]\d* of 486 MB/)
    // the download never holds a step up
    await page.getByTestId('demo-skip').click()
    await page.getByTestId('demo-next').click()
    await expect(line(page)).toContainText('Listening model ready', { timeout: 20_000 })
    await expect.poll(savedCheck(d.userData), { timeout: 10_000 }).toMatchObject({ threads: 4 })
  } finally {
    await app.close()
  }

  const o = fresh('offline')
  const offline = await launch({ REELSTUDIO_USER_DATA: o.userData, REELSTUDIO_MODELS_DIR: o.models, FAKE_ENGINE_DOWNLOAD_STEP: '0.1', FAKE_ENGINE_OFFLINE: '1' })
  try {
    await toStage(offline.page)
    await expect(offline.page.getByTestId('model-error')).toHaveText(
      'The download stopped. Check your internet connection and try again; it will pick up where it left off.'
    )
    await expect(offline.page.getByTestId('model-retry')).toHaveText('Try again')
  } finally {
    await offline.app.close()
  }
})

test('a failed timing check keeps the usual thread count and says so, once', async () => {
  const d = fresh('failed')
  const cache = cachedModel(d.dir)
  const { app, page } = await launch({ REELSTUDIO_USER_DATA: d.userData, REELSTUDIO_MODELS_DIR: d.models, ...cache.env, FAKE_ENGINE_FAIL: 'speech-check' })
  try {
    await toStage(page)
    await expect(page.getByTestId('model-check-failed')).toHaveText(
      "I couldn't work out the fastest settings for this computer, so the listening model uses its usual ones. Everything still works."
    )
    expect(savedCheck(d.userData)()).toMatchObject({ threads: null }) // main's rule, and no second try on this computer
  } finally {
    await app.close()
  }
})
