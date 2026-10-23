// Settings search: every setting is found by its label or a synonym (test/settings-search.test.ts); this checks the
// page shows only what was found, under its section, and that Esc brings everything back.
import { test, expect } from '@playwright/test'
import { launch, openSettings, passFirstRun } from './helpers'

test('fails if a Settings search shows rows it did not find, hides a match, or Esc does not clear it', async () => {
  const { app, page } = await launch()
  try {
    await passFirstRun(page)
    await openSettings(page)
    await expect(page.getByTestId('titlebar-title')).toHaveText('Settings')
    const search = page.getByTestId('settings-search')
    await expect(search).toBeFocused()

    await search.fill('telemetry')
    await expect(page.locator('[data-setting="sharing"]')).toBeVisible()
    await expect(page.getByTestId('share-on')).toBeVisible()
    await expect(page.getByTestId('settings-privacy')).toBeVisible()
    await expect(page.getByTestId('settings-editor')).toBeHidden()
    await expect(page.locator('[data-setting="library-folder"]')).toHaveCount(0)

    await search.fill('folder')
    await expect(page.locator('[data-setting]:visible')).toHaveCount(1)
    await expect(page.getByTestId('root-display')).toBeVisible()

    await search.fill('server')
    await expect(page.getByTestId('own-server-toggle')).toBeVisible() // found under Advanced without opening it

    await search.fill('qwertyuiop')
    await expect(page.getByTestId('settings-no-match')).toHaveText(/No settings match “qwertyuiop”\./)
    await expect(page.locator('[data-setting]:visible')).toHaveCount(0)

    await search.press('Escape')
    await expect(search).toHaveValue('')
    await expect(page.locator('[data-setting="library-folder"]')).toBeVisible()
    await expect(page.getByTestId('settings-editor')).toBeVisible()
    await expect(page.getByTestId('own-server-toggle')).toBeHidden() // Advanced is closed again
  } finally {
    await app.close()
  }
})
