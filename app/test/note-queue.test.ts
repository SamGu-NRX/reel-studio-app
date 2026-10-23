// Notes sent while a note runs (main/note-queue.ts), driven like the app drives them: the job lane, the
// mock AI's slow practice note (REELSTUDIO_MOCK_NOTE), and the stand-in engine's real renders.
import { describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEngineRunner, type RunEngine } from '../src/main/engine'
import { createJobManager, WAITING_FOR_RENDER } from '../src/main/jobs'
import { createMockAI } from '../src/main/ai-mock'
import { createNoteQueue } from '../src/main/note-queue'
import { handEditJob } from '../src/main/hand-edit'
import { diffProject } from '../src/shared/hand-edit'
import { keptIds } from '../src/shared/cut'
import { withRenderSlot } from '../src/main/render-slot'
import { engineEnv, reelStudioRoot } from '../src/main/paths'
import { projectDir, readAppState, readProject, readWords, recoverInterrupted, updateAppState, writeJson, writeProject } from '../src/main/store'
import type { JobEvent, QueuedNote } from '../src/shared/api'
import { FAKE_ENGINE, makeClip, PYTHON, setupPaths } from './helpers'

process.env.REELSTUDIO_MOCK_NOTE = '400'

type NoteRun = (slug: string, note: { id: string; text: string }, signal: AbortSignal, owner: string | null) => Promise<{ summary: string; version: number }>

function app(opts: { failRender?: () => boolean; onRender?: (phase: 'start' | 'end') => void; note?: (run: RunEngine) => NoteRun } = {}) {
  const engine = createEngineRunner({
    python: () => PYTHON,
    env: () => ({ ...engineEnv(), PYTHONPATH: FAKE_ENGINE, ...(opts.failRender?.() ? { FAKE_ENGINE_FAIL: 'render' } : {}) })
  })
  const counted: typeof engine = async (command, args, onProgress, signal) => {
    if (command === 'render') opts.onRender?.('start')
    try {
      return await engine(command, args, onProgress, signal)
    } finally {
      if (command === 'render') opts.onRender?.('end')
    }
  }
  const events: JobEvent[] = []
  const runEngine = withRenderSlot(counted, (owner, waiting) => jobs.waitingForRender(owner, waiting))
  const customNote = opts.note?.(runEngine)
  const jobs = createJobManager((e) => (events.push(e), queue.onJobEvent(e)), () => undefined)
  const ai = createMockAI({ host: { runEngine, renderAnimation: async () => '', reelStudioRoot }, settingsDir: join(reelStudioRoot(), 'ai') })
  // as index.ts startNote
  const queue = createNoteQueue({
    jobs,
    startNote: async (slug, note, record) =>
      jobs.start(slug, 'note', async (emit, signal, { owner }) => {
        if (customNote) return customNote(slug, note, signal, owner)
        const r = await ai.applyNote(projectDir(slug), note.text, emit, signal, { id: note.id, ...(owner ? { owner } : {}) })
        return { summary: r.summary, version: r.version }
      }, { record }),
    // as index.ts startHand
    startHand: async (slug, entry, record) => jobs.start(slug, 'rerender', handEditJob(runEngine, slug, entry), { record }),
    changed: () => undefined,
    log: () => undefined
  })
  const send = (slug: string, text: string) => queue.send(slug, { text, attachments: [] }, 1)
  return { ai, jobs, queue, events, send }
}

async function reel(slug: string): Promise<string> {
  const dir = projectDir(slug)
  mkdirSync(dir, { recursive: true })
  const clip = makeClip(join(dir, '..', `${slug}.mp4`))
  const run = createEngineRunner({ python: () => PYTHON, env: () => ({ ...engineEnv(), PYTHONPATH: FAKE_ENGINE }) })
  await run('init', ['--project', dir, '--title', slug, '--slug', slug, clip])
  await run('render', ['--project', dir])
  return slug
}

const until = async (ok: () => Promise<boolean> | boolean): Promise<void> => {
  while (!(await ok())) await new Promise((r) => setTimeout(r, 20))
}
const replies = async (slug: string): Promise<string[]> => (await readAppState(slug)).chat.filter((m) => m.from === 'editor').map((m) => m.text)
const waitingTexts = async (slug: string): Promise<string[]> => ((await readAppState(slug)).queue ?? []).map((q) => q.text)
const entry = (id: string, text: string, started = false): QueuedNote => ({
  id, text, attachments: [], seenVersion: 1, ...(started ? { attempt: { base: 1 } } : {})
})

describe('note queue', () => {
  it('notes sent while one runs each run after it, in order, and each makes its own version', async () => {
    setupPaths()
    const slug = await reel('in-order')
    const a = app()
    expect((await a.send(slug, 'first')).jobId).toBeTruthy()
    expect(await a.send(slug, 'second')).toEqual({ jobId: null, queued: true })
    expect(await a.send(slug, 'third')).toEqual({ jobId: null, queued: true })
    await until(async () => (await replies(slug)).length === 3)
    expect(await replies(slug)).toEqual(['Done: "first". It is Version 2.', 'Done: "second". It is Version 3.', 'Done: "third". It is Version 4.'])
    expect((await readProject(slug)).version).toBe(4)
    expect(await waitingTexts(slug)).toEqual([])
  }, 60000)

  it('Stop holds the waiting notes, and nothing starts until Run next', async () => {
    setupPaths()
    const slug = await reel('stop')
    const a = app()
    const { jobId } = await a.send(slug, 'first')
    await a.send(slug, 'second')
    await a.send(slug, 'third')
    a.queue.stop(jobId!)
    await until(async () => !!(await readAppState(slug)).queueHeld)
    expect(a.jobs.forSlug(slug)).toBeUndefined()
    expect(await waitingTexts(slug)).toEqual(['second', 'third'])
    expect((await readProject(slug)).version).toBe(1)

    await a.queue.runNext(slug)
    await until(async () => (await replies(slug)).length === 2)
    expect((await readProject(slug)).version).toBe(3)
  }, 60000)

  it('a note that fails holds the queue instead of skipping to the next one', async () => {
    setupPaths()
    const slug = await reel('fails')
    const a = app({ failRender: () => true })
    await a.send(slug, 'first')
    await a.send(slug, 'second')
    await until(async () => !!(await readAppState(slug)).queueHeld)
    expect(a.jobs.forSlug(slug)).toBeUndefined()
    expect(await waitingTexts(slug)).toEqual(['first', 'second'])
    expect((await readProject(slug)).version).toBe(1)
  }, 60000)

  it('a crash before a note is saved: it and the notes behind it come back, waiting for Run next', async () => {
    setupPaths()
    const slug = await reel('crash-before')
    await updateAppState(slug, (s) => {
      s.job = { id: 'job-1', kind: 'note', startedAt: '', noteId: 'q1' }
      s.queue = [entry('q1', 'first', true), entry('q2', 'second')]
    })
    // the next start
    await recoverInterrupted()
    const a = app()
    await a.queue.recover()
    expect(await a.send(slug, 'third')).toEqual({ jobId: null, queued: true })
    expect(a.jobs.forSlug(slug)).toBeUndefined()
    expect(await waitingTexts(slug)).toEqual(['first', 'second', 'third'])

    await a.queue.runNext(slug)
    await until(async () => (await replies(slug)).length === 4)
    expect((await readProject(slug)).version).toBe(4)
  }, 60000)

  it('a crash after a note is saved but before it left the queue: it is not run a second time', async () => {
    setupPaths()
    const slug = await reel('crash-after')
    const a = app()
    await a.ai.applyNote(projectDir(slug), 'first', () => undefined, undefined, { id: 'q1' })
    await updateAppState(slug, (s) => {
      s.job = { id: 'job-1', kind: 'note', startedAt: '', noteId: 'q1' }
      s.queue = [entry('q1', 'first', true), entry('q2', 'second')]
    })
    await recoverInterrupted()
    await a.queue.recover()
    expect(await replies(slug)).toEqual(['I made your change. It is Version 2.'])
    expect(await waitingTexts(slug)).toEqual(['second'])

    await a.queue.runNext(slug)
    await until(async () => (await replies(slug)).length === 2)
    expect((await readProject(slug)).version).toBe(3)
  }, 60000)

  it('notes on two reels run at once, but only one of them renders at a time', async () => {
    setupPaths()
    const [one, two] = [await reel('reel-one'), await reel('reel-two')]
    let rendering = 0
    let most = 0
    const a = app({ onRender: (p) => ((rendering += p === 'start' ? 1 : -1), (most = Math.max(most, rendering))) })
    await Promise.all([a.send(one, 'brighter'), a.send(two, 'brighter')])
    await until(async () => (await replies(one)).length === 1 && (await replies(two)).length === 1)
    expect(most).toBe(1)
    expect((await readProject(one)).version).toBe(2)
    expect((await readProject(two)).version).toBe(2)
    expect(a.events.some((e) => e.type === 'status' && e.message === WAITING_FOR_RENDER)).toBe(true)
  }, 60000)

  it('fails if a hand edit made while a note runs is lost, or lands on the version before the note', async () => {
    setupPaths()
    const slug = await reel('hand-behind-note')
    // like the AI's applyNote: it edits a copy of project.json taken when it starts, renders it, and saves it whole
    const note = (run: RunEngine): NoteRun => async (s, n, signal, owner) => {
      const dir = projectDir(s)
      const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
      await new Promise((r) => setTimeout(r, 600))
      p.captions = { ...p.captions, style: { ...p.captions.style, size: 126 } }
      p.notes = [...(p.notes ?? []), { id: n.id, version: p.version, text: n.text, applied: ['captions'], at: '' }]
      mkdirSync(join(dir, 'work', 'notes', n.id), { recursive: true })
      await writeJson(join(dir, 'work', 'notes', n.id, 'edit.json'), p)
      const r = (await run('render', ['--project', dir, '--project-file', `work/notes/${n.id}/edit.json`, ...(owner ? ['--owner', owner] : [])], undefined, signal)) as { version: number }
      await writeProject(s, { ...JSON.parse(readFileSync(join(dir, 'work', 'notes', n.id, 'edit.json'), 'utf8')), version: r.version })
      return { summary: 'Bigger subtitles.', version: r.version }
    }
    const a = app({ note })
    expect((await a.send(slug, 'bigger subtitles')).jobId).toBeTruthy()

    // Edit it myself, opened on Version 1 while the note runs: subtitles higher
    const v1 = await readProject(slug)
    const words = await readWords(projectDir(slug), v1)
    const kept = new Set(keptIds(words, v1.cut?.keep))
    const edited = { ...v1, captions: { ...v1.captions!, style: { ...v1.captions!.style, position: 0.66 } } }
    const sent = await a.queue.sendHand(slug, { edit: diffProject(v1, edited, kept, kept), changes: 1 }, 'subtitles moved up', 1)
    expect(sent).toEqual({ jobId: null, queued: true })

    await until(async () => (await readProject(slug)).version === 3 && !a.jobs.forSlug(slug))
    const style = (n: number) => JSON.parse(readFileSync(join(projectDir(slug), 'versions', `v${n}`, 'project.json'), 'utf8')).captions.style
    expect(style(2)).toMatchObject({ size: 126 })
    expect(style(2).position).not.toBe(0.66)
    expect(style(3)).toMatchObject({ size: 126, position: 0.66 })
    expect((await readProject(slug)).captions?.style).toMatchObject({ size: 126, position: 0.66 })
    expect((await readAppState(slug)).queue).toEqual([])
    expect((await readAppState(slug)).versionsMade?.find((m) => m.version === 3)).toMatchObject({ by: 'hand', summary: 'subtitles moved up' })
  }, 60000)
})
