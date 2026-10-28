// The timeline's lanes, end to end: pictures above the rail, your video on it (a clip from another video drawn as its
// own kind), sounds under it. Each lane is one named stop in the tab order, its arrows move between items, each item
// is named for what it is, when and why, and a picture opens in Edit it myself.
//
// The reels are made by the fake engine, then given a fixture edit (words, cut, pictures, sounds, a render's
// segments and a video of the same length), so a long reel with many pictures and a multi-source reel can be drawn
// without the real engine. Run after a build, as smoke.spec.ts.
import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, launch, makeMedia, makeReel, passFirstRun, shot } from './helpers'

const MINE = mkdtempSync(join(BASE, 'lanes-'))
const ROOT = join(MINE, 'Documents', 'Reel Studio')
const LEXICON = ['every', 'morning', 'I', 'make', 'coffee', 'first', 'then', 'walk', 'the', 'dog', 'around', 'the', 'park', 'before', 'work', 'starts']
const TREATMENTS: [string, string | null, Record<string, unknown>][] = [
  ['card-above-head', 'Library/Images/cup.png', {}],
  ['side-card', 'Library/Images/dog.png', {}],
  ['text-pop', null, { text: 'before work' }],
  ['phone-card', 'Library/Videos/walk.mp4', {}],
  ['full-frame', 'Library/Images/park.jpg', {}]
]

interface Fixture {
  seconds: number
  pictures: number
  /** a clip of a second video, played whole after the first kept range */
  clip?: boolean
}

/** Gives the reel on screen a fixture Version 1: words, a cut, pictures, sounds and a song, and a render of them. */
function seed(slug: string, f: Fixture): void {
  const dir = join(ROOT, 'Projects', slug)
  const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  const words = Array.from({ length: Math.floor(f.seconds / 0.45) }, (_, i) => ({ id: `f${i}`, w: LEXICON[i % LEXICON.length], s: i * 0.45, e: i * 0.45 + 0.32, source: 's1' }))
  // kept ranges of 16 words, two cut between each
  const ranges: { from: number; to: number }[] = []
  for (let i = 0; i + 16 <= words.length; i += 18) ranges.push({ from: i, to: i + 15 })
  const keep: unknown[] = ranges.map((r) => ({ from: words[r.from].id, to: words[r.to].id }))
  const segments: { source: string; src_start: number; src_end: number; out_start: number }[] = []
  let out = 0
  const add = (source: string, a: number, b: number) => {
    segments.push({ source, src_start: a, src_end: b, out_start: Math.round(out * 1000) / 1000 })
    out += b - a
  }
  ranges.forEach((r, k) => {
    add('s1', Math.max(0, words[r.from].s - 0.08), words[r.to].e + 0.08)
    if (k === 0 && f.clip) {
      keep.splice(1, 0, { clip: 'c1', source: 's2', in: 2, out: 7 })
      add('s2', 2, 7)
    }
  })
  const duration = Math.round(out * 1000) / 1000
  // pictures spread over the kept ranges, each on four words
  const starts = ranges.flatMap((r) => [r.from + 1, r.from + 9])
  const broll = Array.from({ length: f.pictures }, (_, i) => {
    const w = starts[Math.floor((i * starts.length) / f.pictures)]
    const [treatment, asset, params] = TREATMENTS[i % TREATMENTS.length]
    return { id: `b${i + 1}`, anchor: { from: words[w].id, to: words[w + 3].id }, treatment, asset, params }
  })
  const sfx = [
    { at: { word: words[ranges[0].from + 4].id }, sound: 'whoosh-quick' },
    { at: { word: words[ranges[1].from + 6].id }, sound: 'pop-soft' }
  ]
  const project = {
    ...p,
    sources: f.clip ? [...p.sources, { ...p.sources[0], id: 's2' }] : p.sources,
    cut: { ...p.cut, keep },
    broll,
    sfx,
    music: { enabled: true, track: 'Library/Music/happy song.mp3', startAt: 0, level: 'under-voice', automation: [], fadeIn: 1.2, fadeOut: 2 }
  }
  writeFileSync(join(dir, p.transcript.file), JSON.stringify({ words }))
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2))
  const v1 = join(dir, 'versions', 'v1')
  writeFileSync(join(v1, 'project.json'), JSON.stringify(project, null, 2))
  writeFileSync(join(v1, 'render.json'), JSON.stringify({ duration, segmentsDetail: segments }))
  writeFileSync(join(v1, 'receipts.json'), JSON.stringify([{ renderId: 'fixture', facts: broll.map((b) => ({ kind: 'broll', id: b.id, before: null, after: b })) }]))
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=270x480:rate=15:duration=${duration}`, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${duration}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(v1, 'export.mp4')])
}

/** Makes a reel, gives it the fixture, and opens it again so it reads the fixture. */
async function reelWith(page: Page, video: string, f: Fixture): Promise<string> {
  await makeReel(page, video)
  const slug = (await page.locator('.reel-page').getAttribute('data-slug'))!
  seed(slug, f)
  await page.getByTestId('nav-home').click()
  await page.locator(`[data-slug="${slug}"] [data-testid=project-card]`).click()
  await expect(page.getByRole('group', { name: 'Your video on the timeline' })).toBeVisible()
  return slug
}

/** The window, and the timeline up close with room for its tips. */
async function shoot(page: Page, name: string): Promise<void> {
  await shot(page, name)
  const b = (await page.locator('.tl').boundingBox())!
  await page.waitForTimeout(150)
  await page.screenshot({ path: join(__dirname, 'screenshots', `${name}-timeline.png`), clip: { x: Math.max(0, b.x - 24), y: b.y - 96, width: b.width + 48, height: b.height + 132 } })
}

test('timeline lanes: pictures, your video and sounds, each named and reachable by keyboard', async () => {
  test.setTimeout(20 * 60_000)
  const media = makeMedia()
  const { app, page } = await launch({ REELSTUDIO_ROOT: ROOT, REELSTUDIO_USER_DATA: join(MINE, 'user data'), REELENGINE_CACHE: join(MINE, 'engine-cache') })
  await passFirstRun(page)
  const pictures = page.getByRole('group', { name: 'Pictures on the timeline' }).getByRole('button')
  const video = page.getByRole('group', { name: 'Your video on the timeline' }).getByRole('button')
  const sounds = page.getByRole('group', { name: 'Sound effects on the timeline' }).getByRole('button')
  const slider = page.getByRole('slider', { name: /^Time in your reel/ })

  // ---- a short reel: each lane is one tab stop, in order, and its arrows move along it ----
  await reelWith(page, media.video, { seconds: 24, pictures: 3 })
  await expect(pictures).toHaveCount(3)
  await expect(pictures.first()).toHaveAccessibleName(/^Picture above your head, 0:0\d to 0:0\d, for the line “morning I make coffee”, Added when Version 1 was made$/)
  await expect(pictures.nth(2)).toHaveAccessibleName(/^Words on screen: “before work”, 0:\d\d to 0:\d\d, for the line “.+”/)
  await expect(video.first()).toHaveAccessibleName(/^Your video, 0:00 to 0:0\d: “every morning I make coffee first…”$/)
  await expect(sounds.first()).toHaveAccessibleName(/^Whoosh at 0:0\d, on “\w+”$/)
  await slider.focus()
  await page.keyboard.press('Tab')
  await expect(pictures.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(pictures.nth(1)).toBeFocused()
  await page.keyboard.press('End')
  await expect(pictures.nth(2)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(video.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(video.nth(1)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(sounds.first()).toBeFocused()
  // back into the pictures: the one last focused keeps the stop
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(pictures.nth(2)).toBeFocused()
  await shoot(page, 'lanes-01-short-keyboard')
  await page.mouse.move(0, 0)
  await pictures.first().hover()
  await expect(pictures.first()).toContainText('Picture above your head')
  await shoot(page, 'lanes-02-short-hover')

  // a picture opens in Edit it myself, on its row
  await pictures.first().focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tab', { name: 'Pictures' })).toHaveAttribute('aria-selected', 'true')
  const row = page.getByTestId('picture-row').first()
  await expect(row).toHaveAttribute('aria-current', 'true')
  await expect(pictures.first()).toHaveAttribute('aria-current', 'true')
  await shoot(page, 'lanes-03-short-picture-open')
  // Remove takes it off the timeline, and the lane keeps its tab stop though the picture that held it is gone
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(pictures).toHaveCount(2)
  await slider.focus()
  await page.keyboard.press('Tab')
  await expect(pictures.first()).toBeFocused()
  await page.getByTestId('drawer-close').click()

  // ---- a long reel with many pictures, at the narrowest window ----
  await page.setViewportSize({ width: 1100, height: 720 })
  await reelWith(page, media.video, { seconds: 200, pictures: 36 })
  await expect(pictures).toHaveCount(36)
  // every picture keeps a target of its own: none is covered by its neighbours
  const boxes = await pictures.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })))
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].l).toBeGreaterThanOrEqual(boxes[i - 1].r - 0.5)
  for (const b of boxes) expect(b.r - b.l).toBeGreaterThan(0)
  await slider.focus()
  await page.keyboard.press('Tab')
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight')
  await expect(pictures.nth(20)).toBeFocused()
  await shoot(page, 'lanes-04-long-narrow-keyboard')
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(0, 0)
  await shoot(page, 'lanes-05-long')

  // ---- a clip of another video, between two kept ranges ----
  await reelWith(page, media.video, { seconds: 40, pictures: 4, clip: true })
  // five kept ranges, the clip after the first
  await expect(video).toHaveCount(6)
  await expect(video.nth(1)).toHaveAccessibleName('Video 2, played whole, 0:07 to 0:12')
  await expect(page.getByTestId('timeline-clip')).toHaveCount(1)
  const clipBox = (await page.getByTestId('timeline-clip').boundingBox())!
  await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2)
  await expect(page.getByTestId('timeline-part-tip')).toContainText('Video 2, played whole')
  await shoot(page, 'lanes-06-multi-source-hover')

  await app.close()
})
