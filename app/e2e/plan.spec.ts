// A reel with no video is planned in its notes column: a chat with the editor (the practice editor here,
// REELSTUDIO_MOCK_NOTE) that asks two questions and proposes a Plan card, or a plain form with no editor. The plan
// goes to the first edit when the video arrives.
import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, passFirstRun } from './helpers'

function freshProfile(name: string): Record<string, string> {
  const dir = mkdtempSync(join(BASE, `plan-${name}-`))
  return { REELSTUDIO_USER_DATA: join(dir, 'user data'), REELSTUDIO_ROOT: join(dir, 'Reel Studio'), REELSTUDIO_PHONE_HOST: '127.0.0.1' }
}

const slugOf = (page: Page) => page.locator('.reel-page').getAttribute('data-slug') as Promise<string>
const planOf = (page: Page, slug: string) => page.evaluate((s) => window.reel.projects.get(s).then((d) => d.plan), slug)

async function say(page: Page, text: string): Promise<void> {
  await page.getByTestId('note-input').fill(text)
  await page.keyboard.press('Enter')
}

test('plan a reel with the editor, edit a beat, then film it', async () => {
  const media = makeMedia()
  const { app, page } = await launch({ ...freshProfile('editor'), REELSTUDIO_MOCK_NOTE: '1500' })
  await passFirstRun(page)
  await page.getByTestId('new-reel').click()
  await expect(page.getByRole('heading', { name: 'Plan with your editor' })).toBeVisible()
  await expect(page.getByTestId('plan-empty')).toBeVisible()
  const slug = await slugOf(page)

  // the call can be stopped; its words wait to be sent again and are not read as said
  await say(page, 'How I make sourdough without a mixer')
  const strip = page.getByTestId('note-progress')
  await expect(strip).toContainText('Planning your reel')
  await expect(page.getByTestId('plan-answering')).toBeVisible()
  await strip.getByRole('button', { name: 'Stop' }).click()
  await expect(page.getByTestId('log-stopped')).toBeVisible()
  await page.getByTestId('log-retry').click()

  // the honest wait from round 9.1 shows in place of the step, then the first question
  await expect(strip).toContainText('Waiting for your editor to answer')
  await expect(strip.getByTestId('steps')).toHaveCount(0)
  await expect(page.getByTestId('plan-question')).toHaveText('Who is it for?')
  // the box asks for the answer to the editor's question (10-28 audit, finding 9)
  await expect(page.getByTestId('note-input')).toHaveAttribute('placeholder', 'Answer, or tell your editor more…')
  await say(page, 'People who have never baked bread')
  // while the editor answers, words can be written but not sent, and nothing turns red (finding 8)
  await expect(page.getByTestId('note-input')).toHaveAttribute('placeholder', 'Your editor is answering…')
  await page.getByTestId('note-input').fill('and busy parents')
  await expect(page.getByTestId('send')).toBeDisabled()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('change-alert')).toHaveCount(0)
  await expect(page.getByTestId('plan-question').nth(1)).toHaveText("What's the one thing they should take away?")
  await expect(page.getByTestId('note-input')).toHaveValue('and busy parents')
  await expect(page.getByTestId('send')).toBeEnabled()
  await page.getByTestId('note-input').fill('')
  await say(page, 'You do not need fancy gear')

  // two questions, then the plan: hooks to pick from, 3-6 beats, the shots
  const card = page.getByTestId('plan-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('plan-said')).toHaveCount(1)
  await expect(card.getByRole('radio')).toHaveCount(3)
  await expect(card.getByLabel(/^Beat \d$/)).toHaveCount(5)
  await expect(card.getByLabel(/^Shot \d$/)).toHaveCount(3)
  await expect(page.getByTestId('title')).toHaveText('Sourdough without a mixer')

  // asking for a change in the chat gives the plan again: still one card, under the newest answer
  await say(page, 'Make the hook punchier')
  await expect(page.getByTestId('plan-said')).toHaveCount(2)
  await expect(page.getByTestId('plan-said').last()).toHaveText('I made that change.')
  await expect(card).toHaveCount(1)

  // edit one beat in place, pick the second hook, tick a shot
  const beat = card.getByRole('textbox', { name: 'Beat 2', exact: true })
  await beat.fill('Mix it by hand, then let it rest an hour.')
  await beat.press('Enter')
  await card.getByTestId('plan-hook-1').check()
  await card.getByTestId('plan-shots-tick-0').check()
  await expect.poll(async () => (await planOf(page, slug))?.beats[1]).toEqual({ text: 'Mix it by hand, then let it rest an hour.' })
  await expect.poll(async () => (await planOf(page, slug))?.hook).toBe(1)
  await expect.poll(async () => (await planOf(page, slug))?.shots[0].done).toBe(true)
  // Escape puts a line back as it was
  await beat.fill('something else')
  await beat.press('Escape')
  await expect(beat).toHaveValue('Mix it by hand, then let it rest an hour.')

  // Copy and Send to my phone carry the plan as it now reads
  await card.getByTestId('plan-copy').click()
  await expect(page.getByTestId('toast')).toContainText('Copied.')
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(copied).toContain('Hook: I kneaded bread by hand for a year before I learned this.')
  expect(copied).toContain('2. Mix it by hand, then let it rest an hour.')
  await card.getByTestId('plan-phone').click()
  const url = await page.getByTestId('phone-qr').getAttribute('data-url')
  const phonePage = await (await fetch(url!)).text()
  expect(phonePage).toContain('Mix it by hand, then let it rest an hour.')
  expect(phonePage).toContain('I kneaded bread by hand for a year before I learned this.')
  await expect(page.getByTestId('plan-phone-status')).toContainText('Sent. Check your phone.')
  await page.getByTestId('plan-phone-done').click()
  await expect(page.getByTestId('plan-phone-panel')).toHaveCount(0)
  await expect(card.getByTestId('plan-phone')).toBeFocused()

  // the video: the first edit reads the plan, with the picked hook and the edited beat
  await page.getByTestId('planned-stage').getByTestId('file-input').setInputFiles([media.video])
  await expect(page.getByTestId('log-play-1')).toBeVisible({ timeout: 240_000 })
  const dir = await page.evaluate((s) => window.reel.projects.get(s).then((d) => d.dir), slug)
  const script = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).script
  expect(script).toEqual({
    hook: 'I kneaded bread by hand for a year before I learned this.',
    script: 'Flour, water, salt. Nothing else goes in.\nMix it by hand, then let it rest an hour.\nFold it four times, an hour apart.\nIt sleeps in the fridge overnight.\nBake it hot in a closed pot. No mixer, ever.',
    shots: ['You at the kitchen counter, chest up, by the window', 'Your hands folding the dough, close up', 'The loaf coming out of the pot']
  })

  // the plan folds into one line above the video, and opens read-only
  await expect(page.getByRole('heading', { name: 'Notes for your editor' })).toBeVisible()
  await expect(card).toHaveAttribute('data-folded')
  await expect(page.getByTestId('plan-question')).toHaveCount(0)
  await card.getByTestId('plan-unfold').click()
  await expect(card.getByRole('textbox', { name: 'Beat 2', exact: true })).toHaveAttribute('readonly', '')
  await expect(card.getByTestId('plan-copy')).toBeVisible()
  await app.close()
})

test('with no editor, a plain form makes the same Plan card', async () => {
  const { app, page } = await launch(freshProfile('form'))
  await passFirstRun(page)
  await page.getByTestId('new-reel').click()
  await expect(page.getByRole('heading', { name: 'Plan this reel' })).toBeVisible()
  // nobody says "I", and nothing offers a chat no one would answer
  await expect(page.getByTestId('note-input')).toHaveCount(0)
  await expect(page.getByTestId('plan-form')).not.toContainText(/\bI\b/)
  // Save says what is missing and goes to it
  const save = page.getByTestId('plan-save')
  await save.click()
  await expect(page.getByRole('alert')).toHaveText("Say what it's about first.")
  await expect(page.getByLabel("What it's about")).toBeFocused()
  await expect(page.getByLabel("What it's about")).toHaveAttribute('aria-invalid', 'true')

  await page.getByLabel("What it's about").fill('How I make sourdough without a mixer')
  await save.click()
  await expect(page.getByRole('alert')).toHaveText('Add the hook: the first thing you say.')
  await page.getByLabel('Hook').fill('You do not need a mixer to make good bread.')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByLabel('Beat 1').fill('Flour, water, salt.')
  // Enter moves on, and past the last beat adds one
  await page.getByLabel('Beat 1').press('Enter')
  await expect(page.getByLabel('Beat 2')).toBeFocused()
  await page.keyboard.type('Mix it by hand.')
  await page.getByLabel('Beat 3').fill('Fold it, then the fridge.')
  await page.getByLabel('Beat 3').press('Enter')
  await expect(page.getByLabel('Beat 4')).toBeFocused()
  await save.click()

  const card = page.getByTestId('plan-card')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('plan-form')).toHaveCount(0)
  await expect(card.getByRole('radio')).toHaveCount(0)
  await expect(card.getByLabel(/^Beat \d$/)).toHaveCount(3)
  await expect(page.getByTestId('title')).toHaveText('How I make sourdough without a mixer')
  const slug = await slugOf(page)
  await card.getByLabel('Hook 1').fill('No mixer. No problem.')
  await card.getByLabel('Hook 1').press('Enter')
  await expect.poll(async () => (await planOf(page, slug))?.hooks).toEqual(['No mixer. No problem.'])
  await card.getByTestId('plan-copy').click()
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    'How I make sourdough without a mixer\n\nHook: No mixer. No problem.\n\nBeats\n1. Flour, water, salt.\n2. Mix it by hand.\n3. Fold it, then the fridge.'
  )

  // a planned reel is kept when you leave it
  await page.getByTestId('nav-home').click()
  await expect(page.getByTestId('project-card')).toHaveCount(1)
  await app.close()
})
