// A note that didn't finish: it shows once, as its line in the notes, and Try again runs that same note again.
import { test, expect } from '@playwright/test'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, openSettings, passFirstRun } from './helpers'

test('fails if a note that did not finish shows twice (or as a held note), or Try again queues a new note instead of running it', async () => {
  test.setTimeout(10 * 60_000)
  const media = makeMedia()
  const dirs = { REELSTUDIO_USER_DATA: join(BASE, 'failed-note', 'data'), REELSTUDIO_ROOT: join(BASE, 'failed-note', 'Reel Studio'), REELSTUDIO_MOCK_CLAUDE: 'ready', REELSTUDIO_MOCK_NOTE: '300' }
  let { app, page } = await launch(dirs)
  try {
    test.skip((await page.evaluate(() => window.reel.app.info())).ai !== 'mock', 'the mock plays the connected editor')
    await passFirstRun(page)
    await openSettings(page)
    await page.getByTestId('use-claude-code').click()
    await expect(page.getByTestId('ai-connected')).toBeVisible()
    await makeReel(page, media.video)
    const slug = await page.evaluate(() => window.reel.projects.list().then((l) => l[0].slug))
    await app.close()

    ;({ app, page } = await launch({ ...dirs, FAKE_ENGINE_FAIL: 'render' }))
    await page.evaluate((s) => window.dispatchEvent(new CustomEvent('rs:open', { detail: s })), slug)
    await page.getByTestId('project-card').first().click()
    await page.getByTestId('note-input').fill('make the subtitles bigger')
    await page.getByTestId('send').click()
    await expect(page.getByTestId('log-retry')).toBeVisible({ timeout: 120_000 })
    await expect(page.getByTestId('queue-row')).toHaveCount(0)
    expect((await page.evaluate((s) => window.reel.projects.get(s), slug)).queue).toHaveLength(1)
    // nor as "1 note held" under the log: the strip is for a different note that waits (10-28 audit, finding 1)
    expect((await page.evaluate((s) => window.reel.projects.get(s), slug)).queueHeld).toBe(true)
    await expect(page.getByTestId('queue-held')).toHaveCount(0)

    await page.getByTestId('log-retry').click()
    await expect(page.getByTestId('note-progress')).toBeVisible()
    await expect(page.getByTestId('log-retry')).toBeVisible({ timeout: 120_000 })
    expect((await page.evaluate((s) => window.reel.projects.get(s), slug)).queue).toHaveLength(1)
    await expect(page.getByTestId('queue-row')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
