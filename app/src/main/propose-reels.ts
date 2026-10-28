// More reels from this video (notes/design/r11/more-reels.md). The editor reads a reel's whole video and proposes
// the other reels in it; the proposal lives in that reel's app.json. A pick makes each chosen one a new reel that
// starts from the first reel's listening results and the proposed words, and the two share a series.
import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { ReelCandidateView, Word } from '../shared/api'
import type { AI } from './ai-types'
import { toUserError } from './engine'
import type { JobManager } from './jobs'
import { projectDir, readAppState, readJson, readProject, serialized, stamp, uniqueSlug, updateAppState, writeJson, writeProject } from './store'

/** What a new reel starts from, kept in its app.json `from` so a resume can seed it again: the reel it came from and
 * that reel's video, the words the pick was made from, the proposed words, and the brief its first edit reads. */
export interface ReelSeed {
  slug: string
  /** the first reel's video file: the new reel's copy is a hard link to it where the disk allows */
  media: string
  /** sha256 of the first reel's work/transcript.json when it was picked from (StoredProposal.transcriptHash) */
  transcriptHash: string
  keep: { from: string; to: string }[]
  /** the series both reels are in: the first reel's title when the first pick was made */
  series: string
  /** project.json `proposal` of the new reel (ai editor.ts proposedReel) */
  about: { candidate: string; title: string; hook: string; why: string }
}

export interface ReelsDeps {
  jobs: Pick<JobManager, 'start' | 'hold'>
  ai: Pick<AI, 'active' | 'proposeReels'>
  /** index.ts startFirstEdit: prepareReel with the seed in the new reel's app.json, then Version 1 */
  startFirstEdit: (slug: string, init: { title: string; files: string[] }) => string
}

const FINDING = 'Finding the reels in your video'
/** Copied from the first reel with its words, so the new one never listens again: retakes, face track and loudness.
 * A reel heard before one of these existed has none to copy. */
const ALSO_HEARD = ['analysis.json', 'analyze.json', 'face.json', 'envelope.json']
const FIRST_REEL_GONE = { code: 'FIRST_REEL_GONE', userMessage: 'The reel it comes from was deleted.' }
const FIRST_REEL_CHANGED = { code: 'FIRST_REEL_CHANGED', userMessage: 'Your editor listened to the video again since the pick. Find the reels again.' }

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const isRange = (a: unknown): a is { from: string; to: string } =>
  !!a && typeof a === 'object' && typeof (a as { from?: unknown }).from === 'string' && typeof (a as { to?: unknown }).to === 'string'

function said(words: Word[], a: { from: string; to: string }): string {
  const i = words.findIndex((w) => w.id === a.from)
  const j = words.findIndex((w) => w.id === a.to)
  return i < 0 || j < i ? '' : words.slice(i, j + 1).map((w) => String(w.w).trim()).join(' ')
}

function foundLine(found: number, madeBefore: number): string {
  if (found === 0) return madeBefore ? "I didn't find another reel in this video." : "I didn't find another reel in this video. It reads as one piece."
  return found === 1 ? 'I found one more reel in this video.' : `I found ${found} more reels in this video.`
}

/**
 * Starts the editor's look for the reels in `slug`'s video, as a job on that reel: nothing changes in its project.json.
 * Refused before anything starts with no editor, or when the reel is made from more than one video.
 */
export async function startProposal(deps: ReelsDeps, slug: string): Promise<{ jobId: string }> {
  const { ai } = deps
  const active = await ai.active().catch(() => null)
  if (!active?.connected || active.id === 'none' || !ai.proposeReels) {
    throw { code: 'NO_AI', userMessage: 'Connect an editor to find more reels in this video.' }
  }
  if ((await readProject(slug)).sources?.length !== 1) throw { code: 'ONE_VIDEO', userMessage: 'This works on a reel made from one video.' }
  const proposeReels = ai.proposeReels.bind(ai)
  const jobId = deps.jobs.start(slug, 'propose', async (emit, signal, { id }) => {
    const dir = projectDir(slug)
    const p = await readProject(slug)
    const bytes = await fs.readFile(join(dir, 'work', 'transcript.json'))
    const transcript = JSON.parse(bytes.toString('utf8')) as { words: Word[] }
    const analysis = await readJson<Record<string, unknown> | null>(join(dir, 'work', 'analysis.json'), null) ?? await readJson<Record<string, unknown> | null>(join(dir, 'work', 'analyze.json'), null)
    const hash = sha256(bytes)
    // reels already made from an earlier proposal of the same words stay on the card, and no new reel may reuse them
    const before = (await readAppState(slug)).proposal
    const kept = before && before.transcriptHash === hash ? before.candidates.filter((c) => before.made[c.id]) : []
    const taken = [...(p.cut?.keep ?? []).filter(isRange).map(({ from, to }) => ({ from, to })), ...kept.flatMap((c) => c.keep)]

    emit({ type: 'status', message: FINDING, thinking: true })
    const found = await proposeReels(
      {
        transcript: { ...transcript, retakes: analysis?.retakes ?? analysis?.retakeGroups ?? analysis?.retake_groups ?? [] },
        gapCap: typeof p.cut?.gapCap === 'number' ? p.cut.gapCap : 0.25,
        title: p.title,
        taken
      },
      signal,
      emit
    )
    // Stop pressed while the editor answered: nothing is written
    if (signal.aborted) throw { code: 'CANCELLED', userMessage: 'Stopped.' }
    const fresh: ReelCandidateView[] = found.candidates.map((c, i) => ({
      id: `r${kept.length + i + 1}`, title: c.title, hook: c.hook, keep: c.keep, why: c.why, seconds: c.seconds, words: c.words,
      hookText: said(transcript.words, c.hook)
    }))
    const candidates = [...kept, ...fresh]
    await updateAppState(slug, (s) => {
      if (!candidates.length) return void delete s.proposal
      s.proposal = {
        at: new Date().toISOString(), jobId: id, transcriptHash: hash, notes: found.notes, candidates,
        made: Object.fromEntries(kept.map((c) => [c.id, before!.made[c.id]]))
      }
    })
    const line = foundLine(fresh.length, kept.length)
    return { summary: line, chat: [{ from: 'editor', text: line, reels: true }] }
  })
  return { jobId }
}

/**
 * Makes a reel from each picked candidate, in the proposal's order. The first reel gets its series, and each new reel
 * starts its own Version 1 from the proposed words. Refused, with nothing made, while a job or edit runs on the first
 * reel, or when the proposal no longer fits its words.
 */
export async function makeReels(deps: ReelsDeps, slug: string, ids: string[]): Promise<{ made: { id: string; slug: string }[] }> {
  return deps.jobs.hold(slug, async () => {
    const dir = projectDir(slug)
    const proposal = (await readAppState(slug)).proposal
    if (!proposal) throw { code: 'PROPOSAL_GONE', userMessage: 'Find the reels in this video again.' }
    const hash = sha256(await fs.readFile(join(dir, 'work', 'transcript.json')))
    if (hash !== proposal.transcriptHash) {
      throw { code: 'PROPOSAL_STALE', userMessage: 'Your editor listened to this video again since. Find the reels again.' }
    }
    const picks = proposal.candidates.filter((c) => ids.includes(c.id))
    if (picks.length !== ids.length) throw { code: 'PROPOSAL_GONE', userMessage: "That reel isn't in the list any more. Find the reels again." }
    if (picks.some((c) => proposal.made[c.id])) throw { code: 'ALREADY_MADE', userMessage: 'That reel is made already. Open it from the list.' }

    const p = await readProject(slug)
    const series = typeof p.series === 'string' && p.series.trim() ? p.series.trim() : p.title
    if (p.series !== series) {
      p.series = series
      // updatedAt stays: a series is not an edit, and the reel keeps its place on Home
      const file = join(dir, 'project.json')
      await serialized(file, () => writeJson(file, p))
    }
    const source = p.sources![0]
    const media = isAbsolute(source.path) ? source.path : join(dir, ...source.path.split('/'))

    const made: { id: string; slug: string }[] = []
    try {
      for (const c of picks) {
        const child = await uniqueSlug(c.title)
        const from: ReelSeed = { slug, media, transcriptHash: hash, keep: c.keep, series, about: { candidate: c.id, title: c.title, hook: c.hookText, why: c.why } }
        await updateAppState(child, (s) => {
          s.status = 'working'
          s.title = c.title
          s.createdAt = new Date().toISOString()
          s.from = from
        })
        // recorded before its job starts, so a reel that fails at once is never recorded after its row was given back
        await updateAppState(slug, (s) => void (s.proposal && (s.proposal.made[c.id] = child)))
        try {
          deps.startFirstEdit(child, { title: c.title, files: [media] })
        } catch (e) {
          // a reel whose Version 1 never started would wait on Home for ever
          await dropReel(child, from, null)
          throw e
        }
        made.push({ id: c.id, slug: child })
      }
    } finally {
      if (made.length) {
        const titles = picks.filter((c) => made.some((m) => m.id === c.id)).map((c) => c.title).join(', ')
        const text = made.length === 1 ? `A reel is being made from this video: ${titles}.` : `${made.length} reels are being made from this video: ${titles}.`
        await updateAppState(slug, (s) => void s.chat.push(stamp({ from: 'editor', text, reels: true })))
      }
    }
    return { made }
  })
}

/** Not now folds the card to one line; Show opens it again. */
export async function foldProposal(slug: string, folded: boolean): Promise<void> {
  await updateAppState(slug, (s) => {
    if (s.proposal) s.proposal.folded = folded
  })
}

/**
 * A new reel's first step, run by its first-edit job (index.ts startFirstEdit): its copy of the video (`copyIn`,
 * engine init), then seedReel, as one step. A seeded reel skips it, so a reel the app closed on between the two is
 * seeded on its resume. When a pick's reel can't be made, it goes, and its row on the first reel's card is offered
 * again with a line that says why. A resumed one is refused with the reason instead, and stays for the person to
 * delete. Stop keeps it, to be resumed.
 */
export async function prepareReel(slug: string, from: ReelSeed, copyIn: () => Promise<unknown>, how: { resumed: boolean; signal?: AbortSignal }): Promise<void> {
  const file = join(projectDir(slug), 'project.json')
  if (existsSync(file) && (await readProject(slug)).proposal) return
  try {
    if (!existsSync(file)) await copyIn()
    await seedReel(slug, from)
  } catch (e) {
    if (how.signal?.aborted) throw e
    const why = toUserError(e)
    if (how.resumed) throw { code: why.code, userMessage: `This reel can't be made any more. ${why.userMessage}` }
    await dropReel(slug, from, why.userMessage)
    throw e
  }
}

/** A pick's reel that can't be made: its folder goes, and its row on the first reel's card is offered again, with
 * `why` in that reel's log. Nothing is left to clear when the first reel was deleted. */
async function dropReel(slug: string, from: ReelSeed, why: string | null): Promise<void> {
  await fs.rm(projectDir(slug), { recursive: true, force: true })
  if (!existsSync(join(projectDir(from.slug), 'app.json'))) return
  await updateAppState(from.slug, (s) => {
    if (s.proposal?.made[from.about.candidate] === slug) delete s.proposal.made[from.about.candidate]
    if (why) s.chat.push(stamp({ from: 'editor', text: `${from.about.title} wasn't made. ${why}`, reels: true }))
  })
}

/**
 * The new reel after `engine init` made its project.json: the first reel's listening results, so its first edit never
 * listens again and its word ids match, then the proposed words as its cut, the series, and what it is about. Refused
 * when the first reel or its words are gone or have changed since the pick: the words copied are the bytes checked.
 */
async function seedReel(slug: string, from: ReelSeed): Promise<void> {
  const src = join(projectDir(from.slug), 'work')
  const dst = join(projectDir(slug), 'work')
  const heard = await fs.readFile(join(src, 'transcript.json')).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
  if (!heard) throw FIRST_REEL_GONE
  if (sha256(heard) !== from.transcriptHash) throw FIRST_REEL_CHANGED
  await fs.mkdir(dst, { recursive: true })
  await fs.writeFile(join(dst, 'transcript.json'), heard)
  const p = await readProject(slug)
  for (const name of [...ALSO_HEARD, ...(p.sources ?? []).map((s) => `face-${s.id}.json`)]) {
    await fs.copyFile(join(src, name), join(dst, name)).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e
    })
  }
  p.cut = { ...p.cut, keep: from.keep }
  p.series = from.series
  p.proposal = { ...from.about, from: from.slug }
  await writeProject(slug, p)
}
