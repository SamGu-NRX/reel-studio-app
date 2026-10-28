// More reels from this video (main/propose-reels.ts), driven the way index.ts drives it: the job lane, the mock AI's
// practice editor (REELSTUDIO_MOCK_NOTE) and the stand-in engine's real files.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createEngineRunner, type RunEngine } from '../src/main/engine'
import { createJobManager } from '../src/main/jobs'
import { createMockAI } from '../src/main/ai-mock'
import { makeReels, seedReel, startProposal, type ReelsDeps } from '../src/main/propose-reels'
import { engineEnv, projectsDir, reelStudioRoot } from '../src/main/paths'
import { projectDir, readAppState, readProject, summary } from '../src/main/store'
import type { JobEvent } from '../src/shared/api'
import { FAKE_ENGINE, makeClip, PYTHON, setupPaths } from './helpers'

process.env.REELSTUDIO_MOCK_NOTE = '1'

const ENDS = ['done', 'error', 'cancelled', 'paused']

function app() {
  const engine = createEngineRunner({ python: () => PYTHON, env: () => ({ ...engineEnv(), PYTHONPATH: FAKE_ENGINE }) })
  const commands: { command: string; dir: string }[] = []
  const run: RunEngine = (command, args, onProgress, signal) => {
    commands.push({ command, dir: args[args.indexOf('--project') + 1] })
    return engine(command, args, onProgress, signal)
  }
  const events: JobEvent[] = []
  const jobs = createJobManager((e) => events.push(e), () => undefined)
  const mock = createMockAI({ host: { runEngine: run, renderAnimation: async () => '', reelStudioRoot }, settingsDir: join(reelStudioRoot(), 'ai') })
  /** the reels each call to the editor was asked about */
  const asked: string[] = []
  const ai: ReelsDeps['ai'] = {
    active: () => mock.active(),
    proposeReels: (req, signal, onEvent) => (asked.push(req.title), mock.proposeReels!(req, signal, onEvent))
  }
  const started: string[] = []
  // as index.ts startFirstEdit with `from`
  const startFirstEdit: ReelsDeps['startFirstEdit'] = (slug, init) => {
    started.push(slug)
    return jobs.start(slug, 'first-edit', async (emit, signal, { owner }) => {
      const dir = projectDir(slug)
      await run('init', ['--project', dir, '--title', init.title, '--slug', slug, ...(owner ? ['--owner', owner] : []), ...init.files], undefined, signal)
      await seedReel(slug, init.from)
      const r = await mock.firstEdit(dir, emit, signal, owner ? { owner } : {})
      return { summary: r.summary, version: r.version }
    })
  }
  /** The event that ended the job (or the newest job on `slug`). */
  const ended = async (match: { jobId?: string; slug?: string }): Promise<JobEvent> => {
    const hit = () => events.find((e) => ENDS.includes(e.type) && (match.jobId ? e.jobId === match.jobId : e.slug === match.slug))
    await until(() => !!hit())
    return hit()!
  }
  return { jobs, run, commands, events, asked, started, ended, deps: { jobs, ai, startFirstEdit } }
}

/** A reel from a 12 s clip (or two), heard, cut and at Version 1, as the stand-in engine makes it. */
async function reel(a: ReturnType<typeof app>, title: string, clips = 1): Promise<string> {
  const slug = title.toLowerCase().replace(/\W+/g, '-')
  const dir = projectDir(slug)
  mkdirSync(dir, { recursive: true })
  const files = Array.from({ length: clips }, (_, i) => makeClip(join(dir, '..', `${slug}-${i}.mp4`), 12))
  await a.run('init', ['--project', dir, '--title', title, '--slug', slug, ...files])
  for (const command of ['transcribe', 'analyze', 'autocut', 'render']) await a.run(command, ['--project', dir])
  return slug
}

async function proposed(a: ReturnType<typeof app>, slug: string): Promise<JobEvent> {
  const { jobId } = await startProposal(a.deps, slug)
  return a.ended({ jobId })
}

const until = async (ok: () => boolean): Promise<void> => {
  for (let i = 0; i < 30_000 && !ok(); i++) await new Promise((r) => setTimeout(r, 1))
  if (!ok()) throw new Error('it never happened')
}
const transcript = (slug: string): Buffer => readFileSync(join(projectDir(slug), 'work', 'transcript.json'))
const folders = (): string[] => readdirSync(projectsDir()).sort()

describe('more reels from this video', () => {
  // fails if picking reels makes the wrong number of reels, listens to the video again, or starts them from the whole video
  it('makes a reel from each pick, with the same words, the proposed cut and one series, each to its own Version 1', async () => {
    setupPaths()
    const a = app()
    const slug = await reel(a, 'Sourdough notes')
    await proposed(a, slug)
    const { proposal } = await readAppState(slug)
    const updatedAt = (await readProject(slug)).updatedAt
    const before = a.commands.length

    const { made } = await makeReels(a.deps, slug, ['r1', 'r3'])
    expect(made).toEqual([{ id: 'r1', slug: 'the-one-fold-that-fixed-my-crumb' }, { id: 'r3', slug: 'bake-it-hot-in-a-closed-pot' }])
    for (const m of made) expect(await a.ended({ slug: m.slug })).toMatchObject({ type: 'done', version: 1 })

    expect(a.started).toEqual(made.map((m) => m.slug))
    for (const m of made) {
      expect(transcript(m.slug).equals(transcript(slug))).toBe(true)
      expect((await readProject(m.slug)).cut?.keep).toEqual(proposal!.candidates.find((c) => c.id === m.id)!.keep)
      expect((await readProject(m.slug)).series).toBe('Sourdough notes')
      expect(await summary(m.slug)).toMatchObject({ version: 1, status: 'ready', title: proposal!.candidates.find((c) => c.id === m.id)!.title })
    }
    const children = made.map((m) => projectDir(m.slug))
    expect(a.commands.slice(before).filter((c) => children.includes(c.dir) && ['transcribe', 'analyze', 'autocut'].includes(c.command))).toEqual([])

    const parent = await readProject(slug)
    expect(parent.series).toBe('Sourdough notes')
    // a series is not an edit: the first reel keeps its place on Home
    expect(parent.updatedAt).toBe(updatedAt)
    const after = await readAppState(slug)
    expect(after.proposal!.made).toEqual({ r1: 'the-one-fold-that-fixed-my-crumb', r3: 'bake-it-hot-in-a-closed-pot' })
    expect(after.chat.at(-1)).toMatchObject({ text: '2 reels are being made from this video: The one fold that fixed my crumb, Bake it hot in a closed pot.', reels: true })
  }, 90_000)

  // fails if a pick made after the words were heard again turns stale word ids into a reel
  it('refuses a pick once the video was heard again, and makes nothing', async () => {
    setupPaths()
    const a = app()
    const slug = await reel(a, 'Heard again')
    await proposed(a, slug)
    const heard = JSON.parse(transcript(slug).toString('utf8'))
    heard.words[0].w = 'This'
    writeFileSync(join(projectDir(slug), 'work', 'transcript.json'), JSON.stringify(heard))
    const was = folders()

    await expect(makeReels(a.deps, slug, ['r1'])).rejects.toMatchObject({ code: 'PROPOSAL_STALE', userMessage: 'Your editor listened to this video again since. Find the reels again.' })
    expect(folders()).toEqual(was)
    expect((await readProject(slug)).series).toBeUndefined()
  }, 60_000)

  // fails if a reel made from several videos reaches the editor, which reads one video's words
  it('refuses a reel made from two videos before the editor is asked', async () => {
    setupPaths()
    const a = app()
    const slug = await reel(a, 'Two takes', 2)
    await expect(startProposal(a.deps, slug)).rejects.toMatchObject({ code: 'ONE_VIDEO', userMessage: 'This works on a reel made from one video.' })
    expect(a.asked).toEqual([])
    expect(a.jobs.runningCount()).toBe(0)
  }, 60_000)

  // fails if a pick writes the series or makes reels while a note is changing the first reel
  it('refuses a pick while a note runs on the reel, and makes nothing', async () => {
    setupPaths()
    const a = app()
    const slug = await reel(a, 'Busy reel')
    await proposed(a, slug)
    const gate: { open?: () => void } = {}
    const note = a.jobs.start(slug, 'note', () => new Promise((resolve) => (gate.open = () => resolve({ summary: 'Done.' }))))
    const was = folders()

    await expect(makeReels(a.deps, slug, ['r1'])).rejects.toMatchObject({ code: 'BUSY' })
    expect(folders()).toEqual(was)
    expect((await readProject(slug)).series).toBeUndefined()
    expect((await readAppState(slug)).proposal!.made).toEqual({})
    await until(() => !!gate.open)
    gate.open!()
    await a.ended({ jobId: note })
  }, 60_000)

  // fails if looking for reels changes the reel's edit, or the card loses the words a reel opens on
  it("finds the reels without touching the reel's project.json, and keeps each with its opening words", async () => {
    setupPaths()
    const a = app()
    const slug = await reel(a, 'Untouched')
    const file = join(projectDir(slug), 'project.json')
    const bytes = readFileSync(file)

    expect(await proposed(a, slug)).toMatchObject({ type: 'done', summary: 'I found 3 more reels in this video.' })
    expect(readFileSync(file).equals(bytes)).toBe(true)
    const st = await readAppState(slug)
    expect(st.proposal).toMatchObject({ transcriptHash: createHash('sha256').update(transcript(slug)).digest('hex'), made: {} })
    expect(st.proposal!.candidates.map((c) => [c.id, c.hookText])).toEqual([
      ['r1', 'this is placeholder text from the test engine the'],
      ['r2', 'real engine will write what you actually said here'],
      ['r3', 'so you can see your words and']
    ])
    expect(st.chat.at(-1)).toMatchObject({ from: 'editor', text: 'I found 3 more reels in this video.', reels: true })
  }, 60_000)
})
