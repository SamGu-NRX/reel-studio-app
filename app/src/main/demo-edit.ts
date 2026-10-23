// Demo build only (REELSTUDIO_DEMO=1): New reel stages a live-looking edit instead of planning with a real AI.
// A port of spurs-reelstudio-demo/simulate-edit.py. Version 1 is Rundown's plain cut of Solanke's equaliser with a
// note to the editor already running; over about a minute the note's job reports believable steps through the same
// job:event stream a real note uses, then Version 2 lands: the real Reel Studio edit of the same clip, with the
// editor's real summary. Nothing here calls an AI or the network; the media are APFS clones of the source reel's.
import { execFile } from 'node:child_process'
import { constants as fsc, existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { JobEvent, ProjectJson } from '../shared/api'
import { ffmpegPath, projectsDir } from './paths'
import { readJson, updateAppState, writeJson, type AppState } from './store'

export const DEMO_SLUG = 'new-reel-solanke-equaliser'
const SOURCE = 'solanke-equalises-for-10-man-spurs'
const TITLE = 'Solanke equaliser · new reel'
const SERIES = "Solanke's equaliser"
const ORIGINAL_NAME = 'Rundown plain cut · Solanke equalises for 10-man Spurs.mp4'
const NOTE = 'Make it punchier: add the score, cards for Tonali and Solanke from their ScorePlay photos, and a strong cover.'

/** The note's steps: what the status line says, from which second, and where the bar is by its end (about 60 s). */
const STEPS: { at: number; message: string; to: number }[] = [
  { at: 0, message: 'Reading your note', to: 6 },
  { at: 4, message: 'Reading the commentary', to: 18 },
  { at: 12, message: 'Finding Solanke’s equaliser and the red card', to: 30 },
  { at: 20, message: 'Placing player cards from ScorePlay', to: 46 },
  { at: 30, message: 'Adding the score', to: 58 },
  { at: 37, message: 'Choosing the cover', to: 70 },
  { at: 45, message: 'Rendering Version 2', to: 99 }
]
const TOTAL_S = 60

type Live = { id: string; kind: 'note'; message: string; pct: number; overall: number; secondsLeft: number | null; overdue: false; thinking: false; waiting: false; waitingForRender: false }

const clone = (a: string, b: string): Promise<void> => fs.copyFile(a, b, fsc.COPYFILE_FICLONE)
const iso = (): string => new Date().toISOString()

async function copyTree(from: string, to: string): Promise<void> {
  if (!existsSync(from)) return
  await fs.mkdir(to, { recursive: true })
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.isDirectory()) await copyTree(join(from, e.name), join(to, e.name))
    else await clone(join(from, e.name), join(to, e.name))
  }
}

function frame(video: string, out: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile(ffmpegPath(), ['-loglevel', 'error', '-y', '-ss', '8', '-i', video, '-frames:v', '1', '-vf', 'scale=1080:-2', out], (err) => (err ? reject(err) : resolve()))
  )
}

export function createDemoEdit(emit: (e: JobEvent) => void, log: (line: string) => void) {
  let run: { id: string; timer: NodeJS.Timeout; startedAt: number; live: Live } | null = null

  const stopTimer = () => {
    if (run) clearInterval(run.timer)
    run = null
  }

  const tick = () => {
    if (!run) return
    const t = (Date.now() - run.startedAt) / 1000
    let i = 0
    while (i + 1 < STEPS.length && t >= STEPS[i + 1].at) i++
    const step = STEPS[i]
    const end = STEPS[i + 1]?.at ?? TOTAL_S
    const from = STEPS[i - 1]?.to ?? 0
    const overall = Math.min(99, Math.round(from + ((step.to - from) * Math.min(1, (t - step.at) / (end - step.at)))))
    run.live = { ...run.live, message: step.message, pct: overall, overall, secondsLeft: Math.max(1, Math.round(TOTAL_S - t)) }
    emit({ type: 'status', jobId: run.id, slug: DEMO_SLUG, message: step.message, pct: overall, overall, secondsLeft: run.live.secondsLeft, overdue: false, thinking: false, waiting: false, waitingForRender: false })
    if (t >= TOTAL_S) void land(run.id)
  }

  /** Version 2: the source reel's real edit, its cards' pictures, and the editor's real summary. */
  const land = async (id: string) => {
    if (run?.id !== id) return
    stopTimer()
    const src = join(projectsDir(), SOURCE)
    const dir = join(projectsDir(), DEMO_SLUG)
    try {
      const plain = await readJson<ProjectJson>(join(dir, 'project.json'), {} as ProjectJson)
      await fs.mkdir(join(dir, 'versions', 'v2'), { recursive: true })
      await clone(join(src, 'versions', 'v1', 'export.mp4'), join(dir, 'versions', 'v2', 'export.mp4'))
      await clone(join(src, 'versions', 'v1', 'cover.png'), join(dir, 'versions', 'v2', 'cover.png'))
      await copyTree(join(src, 'work', 'assets'), join(dir, 'work', 'assets'))
      await copyTree(join(src, 'work', 'thumbs'), join(dir, 'work', 'thumbs'))
      const edited = await readJson<ProjectJson>(join(src, 'project.json'), {} as ProjectJson)
      Object.assign(edited, { id: plain.id, slug: DEMO_SLUG, title: TITLE, series: SERIES, version: 2, createdAt: plain.createdAt, updatedAt: iso() })
      if (edited.sources?.[0]) edited.sources[0].originalName = ORIGINAL_NAME
      await writeJson(join(dir, 'project.json'), edited)
      await writeJson(join(dir, 'versions', 'v2', 'project.json'), edited)
      const summary = (await readJson<AppState>(join(src, 'app.json'), { chat: [] } as unknown as AppState)).chat[0]?.text ?? 'Version 2 is ready.'
      await updateAppState(DEMO_SLUG, (s) => {
        for (const m of s.chat) if (m.jobId === id) m.outcome = 'done'
        s.chat.push({ id: randomUUID(), from: 'editor', text: summary, at: iso(), version: 2, jobId: id })
        s.versionsMade = [...(s.versionsMade ?? []), { version: 2, by: 'note', summary: NOTE, at: iso() }]
        s.job = null
        s.status = 'ready'
        s.review = { status: 'waiting', at: iso() }
      })
      emit({ type: 'done', jobId: id, slug: DEMO_SLUG, summary, version: 2 })
    } catch (e) {
      log(`[demo-edit] Version 2 failed: ${String(e)}`)
      await updateAppState(DEMO_SLUG, (s) => void (s.job = null)).catch(() => {})
      emit({ type: 'error', jobId: id, slug: DEMO_SLUG, code: 'DEMO', userMessage: 'Version 2 could not be made. Press New reel to start over.' })
    }
  }

  /** Makes the reel from scratch (any earlier one is replaced) with Version 1 in and the note running. Returns its slug. */
  const start = async (): Promise<string> => {
    stopTimer()
    const src = join(projectsDir(), SOURCE)
    const dir = join(projectsDir(), DEMO_SLUG)
    if (!existsSync(join(src, 'project.json'))) throw { code: 'NOT_FOUND', userMessage: `The demo needs the reel “${SOURCE}” in the library.` }
    await fs.rm(dir, { recursive: true, force: true })
    for (const sub of ['media', join('versions', 'v1'), 'work']) await fs.mkdir(join(dir, sub), { recursive: true })
    await clone(join(src, 'media', 'take01.mp4'), join(dir, 'media', 'take01.mp4'))
    await clone(join(src, 'media', 'take01.mp4'), join(dir, 'versions', 'v1', 'export.mp4'))
    await fs.copyFile(join(src, 'work', 'transcript.json'), join(dir, 'work', 'transcript.json'))
    await frame(join(dir, 'versions', 'v1', 'export.mp4'), join(dir, 'versions', 'v1', 'cover.png')).catch(async (e) => {
      log(`[demo-edit] no frame for the cover (${String(e)}); using the source reel's`)
      await fs.copyFile(join(src, 'versions', 'v1', 'cover.png'), join(dir, 'versions', 'v1', 'cover.png'))
    })
    const p = await readJson<ProjectJson>(join(src, 'project.json'), {} as ProjectJson)
    const at = iso()
    Object.assign(p, { id: randomUUID(), slug: DEMO_SLUG, title: TITLE, series: SERIES, version: 1, createdAt: at, updatedAt: at, broll: [], zooms: [] })
    if (p.sources?.[0]) p.sources[0].originalName = ORIGINAL_NAME
    await writeJson(join(dir, 'project.json'), p)
    await writeJson(join(dir, 'versions', 'v1', 'project.json'), p)

    const id = randomUUID()
    const state: AppState = {
      chat: [
        { id: randomUUID(), from: 'editor', text: "Version 1 is Rundown's plain cut of Solanke's equaliser, straight from the clip plan.", at, version: 1 },
        { id: randomUUID(), from: 'you', text: NOTE, at, jobId: id }
      ],
      job: { id, kind: 'note', startedAt: at, note: NOTE },
      status: 'ready',
      lastError: null,
      title: TITLE,
      aiEdited: true,
      review: { status: 'draft' }
    }
    await writeJson(join(dir, 'app.json'), state)
    const live: Live = { id, kind: 'note', message: STEPS[0].message, pct: 0, overall: 0, secondsLeft: TOTAL_S, overdue: false, thinking: false, waiting: false, waitingForRender: false }
    run = { id, startedAt: Date.now(), live, timer: setInterval(tick, 1000) }
    log(`[demo-edit] started ${DEMO_SLUG}; Version 2 lands in ${TOTAL_S} s`)
    return DEMO_SLUG
  }

  /** Stop on the running note: it ends as stopped, Version 1 stays. */
  const stop = async (id: string): Promise<boolean> => {
    if (run?.id !== id) return false
    stopTimer()
    await updateAppState(DEMO_SLUG, (s) => {
      for (const m of s.chat) if (m.jobId === id) m.outcome = 'stopped'
      s.job = null
    })
    emit({ type: 'cancelled', jobId: id, slug: DEMO_SLUG })
    return true
  }

  return { start, stop, live: (slug: string): Live | null => (slug === DEMO_SLUG && run ? run.live : null) }
}
