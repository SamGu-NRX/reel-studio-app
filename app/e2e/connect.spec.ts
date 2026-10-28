// "Connect Claude" / "Connect ChatGPT": one click installs the person's own AI app if it is missing, opens that vendor's
// own sign-in page, and makes it the AI editor once the app says it is signed in. The mock AI plays every state
// (REELSTUDIO_MOCK_CLAUDE / REELSTUDIO_MOCK_CODEX, see main/ai-mock.ts); nothing is installed and no browser opens.
// Each vendor is a row of Settings › Editor; a connect's steps open under its row.
//
// Run: `npx playwright test e2e/connect.spec.ts` after `electron-vite build` (unset ELECTRON_RUN_AS_NODE first).
import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, CLAUDE_CODE_MISNAMED, USE_CLAUDE_CODE, launch, openSettings, passFirstRun, shot } from './helpers'

async function connectScreen(claude: string, codex = 'missing') {
  const mine = mkdtempSync(join(BASE, `connect-${claude}-${codex}-`))
  const userData = join(mine, 'user data')
  const { app, page } = await launch({
    REELSTUDIO_MOCK_CLAUDE: claude,
    REELSTUDIO_MOCK_CODEX: codex,
    REELSTUDIO_ROOT: join(mine, 'Documents', 'Reel Studio'),
    REELSTUDIO_USER_DATA: userData
  })
  await passFirstRun(page)
  const info = await page.evaluate(() => window.reel.app.info())
  await openSettings(page)
  const panel = page.locator('#sec-editor')
  for (const v of ['claude', 'chatgpt']) await expect(page.getByTestId(`vendor-${v}`)).not.toHaveAttribute('data-step', 'loading')
  return { app, page, info, userData, panel, claude: page.getByTestId('vendor-claude'), chatgpt: page.getByTestId('vendor-chatgpt') }
}

/** Nothing on screen may call Reel Studio "Claude Code", and no em dashes. */
async function plainWords(page: import('@playwright/test').Page): Promise<void> {
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(CLAUDE_CODE_MISNAMED)
  expect(text).not.toContain('—')
}

test('fresh computer: two rows, Claude first; Connect Claude installs, signs in, connects', async () => {
  const { app, page, info, panel, claude } = await connectScreen('missing')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await expect(panel.locator('.pv-main > button').first()).toHaveAttribute('data-testid', 'connect-claude')
  await expect(page.getByTestId('connect-claude')).toHaveClass(/primary/)
  await expect(page.getByTestId('connect-claude')).toHaveAccessibleName('Connect Claude')
  await expect(page.getByTestId('connect-chatgpt')).not.toHaveClass(/primary/)
  await expect(panel).toContainText("Needs Claude Pro or Max. Installs Anthropic's Claude Code app if you don't have it.")
  await expect(panel).toContainText("Works with your ChatGPT plan, free ones too. Installs OpenAI's Codex app if you don't have it.")
  await expect(page.getByTestId('claude-key-toggle')).toHaveText('Add key') // the advanced choice stays
  await plainWords(page)
  await shot(page, 'connect-01-fresh')
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none')

  await page.getByTestId('connect-claude').click()
  await expect(claude).toHaveAttribute('data-step', 'installing')
  await expect(claude).toContainText("Installing Anthropic's Claude Code app")
  await expect(page.getByTestId('vendor-cancel-claude')).toBeFocused() // focus follows the pressed pill to Cancel
  await shot(page, 'connect-02-installing')
  await expect(claude).toHaveAttribute('data-step', 'signing_in')
  await expect(claude).toContainText("Anthropic's Claude Code app installed")
  await expect(claude).toContainText('Finish signing in in your browser.')
  await expect(claude).toContainText("It's Anthropic's page. Come back here when it says you're signed in.")
  await expect(page.getByTestId('claude-free-hint')).toContainText('need Claude Pro or Max?')
  await expect(page.getByTestId('claude-window-fallback')).toBeVisible()
  await plainWords(page)
  await shot(page, 'connect-03-browser')
  await expect(page.getByTestId('ai-connected')).toHaveText('Connected', { timeout: 15_000 })
  await expect(page.locator('[data-provider="claude-cli"]')).toContainText('Connected')
  await shot(page, 'connect-04-connected')
  await page.getByTestId('nav-home').click()
  await expect(page.getByTestId('ai-status')).toHaveText('Editor: Claude')
  await app.close()
})

test('Connect ChatGPT: installs OpenAI\'s Codex app, its own sign-in, then "ChatGPT (your Codex app)" edits', async () => {
  const { app, page, info, chatgpt } = await connectScreen('missing', 'missing')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-chatgpt').click()
  await expect(chatgpt).toHaveAttribute('data-step', 'installing')
  await expect(chatgpt).toContainText("Installing OpenAI's Codex app")
  await expect(chatgpt).toHaveAttribute('data-step', 'signing_in')
  await expect(chatgpt).toContainText("It's OpenAI's page.")
  await expect(page.getByTestId('claude-free-hint')).toHaveCount(0)
  await expect(page.getByTestId('claude-window-fallback')).toHaveCount(0)
  await shot(page, 'connect-05-chatgpt-browser')
  await expect(page.locator('[data-provider="codex-cli"]')).toContainText('Connected', { timeout: 15_000 })
  await page.getByTestId('nav-home').click()
  await expect(page.getByTestId('ai-status')).toHaveText('Editor: ChatGPT')
  await plainWords(page)
  await app.close()
})

test('already signed in: "Use Claude (your Claude Code app)" comes first, and only the click turns it on', async () => {
  const { app, page, info, panel } = await connectScreen('ready')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await expect(page.getByTestId('use-claude-code')).toHaveAccessibleName(USE_CLAUDE_CODE)
  await expect(panel.locator('.pv-main > button').first()).toHaveAttribute('data-testid', 'use-claude-code')
  await expect(page.getByTestId('use-claude-code')).toHaveClass(/primary/)
  await expect(panel).toContainText('It uses your own Claude plan and its usage limits.')
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none') // never picked on its own
  await page.getByTestId('use-claude-code').click()
  await expect(page.getByTestId('ai-connected')).toHaveText('Connected')
  await plainWords(page)
  await app.close()
})

test('only ChatGPT is ready: "Use ChatGPT (your Codex app)" goes first', async () => {
  const { app, page, info, panel } = await connectScreen('missing', 'ready')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await expect(panel.locator('.pv-main > button').first()).toHaveAttribute('data-testid', 'use-codex')
  await expect(page.getByTestId('use-codex')).toHaveAccessibleName('Use ChatGPT (your Codex app)')
  await expect(page.getByTestId('use-codex')).toHaveClass(/primary/)
  await shot(page, 'connect-08-chatgpt-ready')
  await app.close()
})

test('installing: Cancel goes back to the button', async () => {
  const { app, page, info, claude } = await connectScreen('installing')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-claude').click()
  await expect(claude).toHaveAttribute('data-step', 'installing')
  await page.getByTestId('vendor-cancel-claude').click()
  await expect(page.getByTestId('connect-claude')).toBeVisible()
  await expect(page.getByTestId('connect-claude')).toBeFocused()
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none')
  await app.close()
})

test('install failed: plain words, Try again, Install it myself (the vendor\'s page)', async () => {
  const { app, page, info, claude } = await connectScreen('install_failed')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-claude').click()
  await expect(claude).toHaveAttribute('data-step', 'failed')
  await expect(claude).toHaveAttribute('data-problem', 'install_failed')
  await expect(page.getByTestId('vendor-message-claude')).toContainText("couldn't reach Anthropic")
  await expect(page.getByTestId('vendor-retry-claude')).toHaveText('Try again')
  await expect(page.getByTestId('vendor-install-page-claude')).toHaveAttribute('href', 'https://code.claude.com/docs/en/setup')
  await plainWords(page)
  await shot(page, 'connect-06-install-failed')
  await app.close()
})

test('the browser page never comes back: Open it again, the window fallback, and choosing ChatGPT instead', async () => {
  const { app, page, info, userData, claude } = await connectScreen('browser', 'signed_out')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-claude').click()
  await expect(claude).toHaveAttribute('data-step', 'signing_in')
  await expect(claude).not.toContainText('installed') // nothing was installed this time
  await page.getByTestId('vendor-again-claude').click()
  await expect(claude).toHaveAttribute('data-step', 'signing_in')
  // "The page shows a code?": today's terminal window, where the code goes into Anthropic's own app
  await page.getByTestId('claude-window-fallback').click()
  const launcher = join(userData, 'claude-sign-in', process.platform === 'win32' ? 'Sign in to Claude.cmd' : 'Sign in to Claude.command')
  await expect.poll(() => { try { return readFileSync(launcher, 'utf8') } catch { return '' } }).toContain('auth login --claudeai')
  // a free Claude plan: switch to ChatGPT from the hint; the waiting Claude sign-in stops
  await page.getByTestId('claude-free-switch').click()
  await expect(page.locator('[data-provider="codex-cli"]')).toContainText('Connected', { timeout: 15_000 })
  await expect(claude).toHaveAttribute('data-step', 'idle')
  await page.getByTestId('use-no-ai').click()
  await expect(page.getByTestId('connect-claude')).toBeVisible()
  await app.close()
})

test('a Claude plan the app reports as free: never chosen, with the way out', async () => {
  const { app, page, info, claude } = await connectScreen('free')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-claude').click()
  await expect(claude).toHaveAttribute('data-problem', 'free_plan', { timeout: 15_000 })
  await expect(page.getByTestId('vendor-message-claude')).toContainText('It needs Claude Pro or Max.')
  await expect(claude).toContainText('Or connect ChatGPT. Its free plan works, with limits.')
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none')
  await plainWords(page)
  await shot(page, 'connect-07-free-plan')
  await app.close()
})

test('fails if a first look that went wrong leaves a row with nothing to press', async () => {
  const mine = mkdtempSync(join(BASE, 'connect-look-'))
  const { app, page } = await launch({ REELSTUDIO_ROOT: join(mine, 'Documents', 'Reel Studio'), REELSTUDIO_USER_DATA: join(mine, 'user data') })
  await passFirstRun(page)
  // the main process can't answer "is Claude's app here?" until the test lets it
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as { lookFails?: boolean }
    g.lookFails = true
    ipcMain.removeHandler('ai:vendorStatus')
    ipcMain.handle('ai:vendorStatus', async (_e, v: string) =>
      g.lookFails ? { ok: false, error: { code: 'LOOK', userMessage: 'no' } } : { ok: true, value: { vendor: v, state: 'missing', step: 'idle' } })
  })
  await openSettings(page)
  await expect(page.getByTestId('vendor-claude')).toContainText("Couldn't look for Anthropic's Claude Code app")
  await app.evaluate(() => void ((globalThis as { lookFails?: boolean }).lookFails = false))
  await page.getByTestId('vendor-look-claude').click()
  await expect(page.getByTestId('connect-claude')).toBeVisible()
  await app.close()
})

test('ChatGPT\'s sign-in port held by Windows: plain words, then one click signs in with a code instead', async () => {
  const { app, page, info, chatgpt } = await connectScreen('missing', 'port_reserved')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-chatgpt').click()
  await expect(chatgpt).toHaveAttribute('data-problem', 'port_busy')
  await expect(page.getByTestId('vendor-message-chatgpt')).toHaveText(/holding the port ChatGPT's sign-in uses\.$/)
  await expect(page.getByTestId('vendor-retry-chatgpt')).toHaveText('Try again')
  const withCode = page.getByTestId('vendor-code-start-chatgpt')
  await expect(withCode).toHaveText('Sign in with a code instead')
  // reserved by Windows: Try again cannot work until the port is freed, so the code is the row's filled pill
  await expect(withCode).toHaveClass(/\bprimary\b/)
  await expect(page.getByTestId('vendor-retry-chatgpt')).not.toHaveClass(/\bprimary\b/)
  await expect(chatgpt.locator('.pv-main > button')).toHaveAttribute('data-testid', 'vendor-code-start-chatgpt')
  await plainWords(page)
  await shot(page, 'connect-12-port-reserved')
  // never on its own: nothing runs until the click
  await page.waitForTimeout(500)
  await expect(chatgpt).toHaveAttribute('data-step', 'failed')
  await withCode.click()
  await expect(chatgpt).toHaveAttribute('data-sign-in', 'code')
  const code = page.getByTestId('vendor-code-chatgpt')
  await expect(code).toHaveText('MOCK-26CODE')
  await expect(page.getByTestId('vendor-code-open-chatgpt')).toHaveAttribute('href', 'https://auth.openai.com/codex/device')
  await expect(chatgpt).toContainText("ChatGPT's security settings")
  await expect(page.getByTestId('vendor-again-chatgpt')).toHaveCount(0) // a new code each time: no "open again"
  await page.getByTestId('vendor-code-copy-chatgpt').click()
  await expect(page.getByTestId('vendor-code-copy-chatgpt')).toHaveText('Copied')
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('MOCK-26CODE')
  await plainWords(page)
  await shot(page, 'connect-13-code')
  // the person enters the code on OpenAI's page; Codex says it worked; checked and chosen
  await expect(page.locator('[data-provider="codex-cli"]')).toContainText('Connected', { timeout: 15_000 })
  await app.close()
})

test('sign-in with a code turned off for the account: says where to turn it on', async () => {
  const { app, page, info, chatgpt } = await connectScreen('missing', 'code_off')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-chatgpt').click()
  await page.getByTestId('vendor-code-start-chatgpt').click()
  await expect(chatgpt).toHaveAttribute('data-problem', 'device_code_off')
  await expect(page.getByTestId('vendor-message-chatgpt')).toContainText("ChatGPT's security settings")
  await expect(page.getByTestId('vendor-code-start-chatgpt')).toBeVisible() // turned on, it can be tried again
  await plainWords(page)
  await shot(page, 'connect-14-code-off')
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none')
  await app.close()
})

test('Cancel while the code is on screen: back to the button', async () => {
  const { app, page, info, chatgpt } = await connectScreen('missing', 'port_reserved')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-chatgpt').click()
  await page.getByTestId('vendor-code-start-chatgpt').click()
  await expect(page.getByTestId('vendor-code-chatgpt')).toBeVisible()
  await page.getByTestId('vendor-cancel-chatgpt').click()
  await expect(page.getByTestId('connect-chatgpt')).toBeVisible()
  await expect(chatgpt).not.toHaveAttribute('data-sign-in', 'code')
  expect((await page.evaluate(() => window.reel.ai.active())).id).toBe('none')
  await app.close()
})

test('ChatGPT\'s sign-in port only in use by another program: Try again stays the filled pill, the code second', async () => {
  const { app, page, info, chatgpt } = await connectScreen('missing', 'port_in_use')
  test.skip(info.ai !== 'mock', 'the mock plays the vendor states')
  await page.getByTestId('connect-chatgpt').click()
  await expect(chatgpt).toHaveAttribute('data-problem', 'port_busy')
  await expect(page.getByTestId('vendor-message-chatgpt')).toHaveText(/holding the port ChatGPT's sign-in uses\.$/)
  await expect(page.getByTestId('vendor-retry-chatgpt')).toHaveClass(/\bprimary\b/)
  await expect(page.getByTestId('vendor-code-start-chatgpt')).not.toHaveClass(/\bprimary\b/)
  await expect(chatgpt.locator('.pv-main > button')).toHaveAttribute('data-testid', 'vendor-retry-chatgpt')
  await plainWords(page)
  await shot(page, 'connect-15-port-in-use')
  await app.close()
})
