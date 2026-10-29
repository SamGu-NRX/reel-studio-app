import { test, expect } from '@playwright/test'
import { launch, makeMedia, makeReel, passFirstRun } from './helpers'

// The overnight tour (notes/design/r11/tour-1028/04-reel-notes-timeline.png): a note about a moment came back as
// 'Done: "At 0:06 (around "…", words w10, w11, …): make the subtitles bigger here"'. The AI is handed the moment and the
// transcript's word ids; the person must only ever see their own words.
test('fails if the reply to a note about a moment shows its word ids or moment wrapper', async () => {
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_MOCK_CLAUDE: 'ready', REELSTUDIO_MOCK_NOTE: '300' })
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)
    await expect.poll(() => page.getByTestId('player').evaluate((v: HTMLVideoElement) => !v.paused || v.ended)).toBe(true)
    await page.evaluate(() => {
      const v = document.querySelector('[data-testid=player]') as HTMLVideoElement
      v.pause()
      v.currentTime = 2
    })
    await expect(page.getByTestId('moment-chip')).toContainText('0:02')
    await page.getByTestId('note-input').fill('make the subtitles bigger here')
    await page.getByTestId('send').click()
    await expect(page.getByTestId('log-play-2')).toBeVisible({ timeout: 120_000 })
    const log = page.getByTestId('chat')
    await expect(log).toContainText('make the subtitles bigger here')
    const text = (await log.textContent()) ?? ''
    expect(text).not.toMatch(/\bw\d+\b/)
    expect(text).not.toContain('(around')
  } finally {
    await app.close()
  }
})
