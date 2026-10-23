// Settings search: every setting is found by its label or a synonym (test/settings-search.test.ts); this checks the
// page shows only what was found, under its section, and that Esc brings everything back.
import { test, expect } from '@playwright/test'
import { launch, openSettings, passFirstRun, shot } from './helpers'

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

// stock-search: Pexels and Pixabay keys sit in Advanced beside the Anthropic key. The stand-in AI keeps no keys,
// so saving one is refused, and the row must say so rather than claim it was saved.
test('fails if the stock photo keys cannot be found, opened, or a refused save looks saved', async () => {
  const { app, page } = await launch()
  try {
    await passFirstRun(page)
    await openSettings(page)
    await page.getByTestId('settings-search').fill('pexels')
    const row = page.locator('[data-provider="pexels"]')
    await expect(row).toContainText('No key, so your editor skips it.')
    await expect(page.locator('[data-provider="pixabay"]')).toBeVisible()
    await page.getByTestId('stock-add-pexels').click()
    await page.getByTestId('stock-key-pexels').fill('not-a-real-key')
    await page.getByTestId('stock-save-pexels').click()
    await expect(row.getByRole('alert')).toContainText('Stock API keys need the AI package.')
    await expect(row).not.toContainText('Key saved')
    await shot(page, 'settings-stock-keys')
  } finally {
    await app.close()
  }
})
