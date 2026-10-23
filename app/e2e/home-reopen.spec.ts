import { test, expect } from '@playwright/test'
import { launch, makeMedia, makeReel, passFirstRun } from './helpers'

test('Home reopens a running note or rerender on the Reel screen', async () => {
  const media = makeMedia()
  const { app, page } = await launch()
  try {
    await passFirstRun(page)
    await makeReel(page, media.video)
    const detail = await page.evaluate(async () => {
      const [p] = await window.reel.projects.list()
      return window.reel.projects.get(p.slug)
    })

    for (const kind of ['note', 'rerender'] as const) {
      // Hold the job snapshot steady while navigating away and back.
      const running = {
        ...detail, status: 'working' as const,
        job: { id: 'running-change', kind, message: 'Reading your note', pct: 10, overall: 10, secondsLeft: null, overdue: false, thinking: false }
      }
      await app.evaluate(({ ipcMain }, d) => {
        ipcMain.removeHandler('projects:list')
        ipcMain.handle('projects:list', () => ({ ok: true, value: [d] }))
        ipcMain.removeHandler('projects:get')
        ipcMain.handle('projects:get', () => ({ ok: true, value: d }))
      }, running)
      await page.getByTestId('nav-home').click()
      await expect(page.getByTestId('card-status')).toContainText('Making')
      await page.getByTestId('project-card').focus()
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('note-progress')).toContainText('Reading your note')
    }

    // Home can still have a working summary after the note has finished: the card opens the Reel screen, ready.
    // (Home no longer reads a reel before opening it, so the old race with a slow read is gone.)
    await app.evaluate(({ ipcMain }, d) => {
      ipcMain.removeHandler('projects:get')
      ipcMain.handle('projects:get', () => ({ ok: true, value: d }))
    }, detail)
    await page.getByTestId('nav-home').click()
    await page.getByTestId('project-card').click()
    await expect(page.getByTestId('export')).toBeEnabled()
  } finally {
    await app.close()
  }
})
