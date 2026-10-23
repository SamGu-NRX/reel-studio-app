import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAction, NoteMoment, PlacedWord, ProjectDetail, ProviderInfo, VersionInfo } from '../../../shared/api'
import { versionTitle } from '../../../shared/describe'
import { clock } from '../../../shared/progress'
import { EMPTY_LIVE, liveFromDetail, reduceLive, type LiveState } from '../../../shared/live'
import { NO_TIMELINE, noSpeech, noteMarks, noteMoment, sourceAt, wordsAt, wordsBetween, type RenderSegment } from '../../../shared/moments'
import { notesLog, type LogEntry } from '../../../shared/notes-log'
import { pausedSentence, pausedWords } from '../../../shared/pause'
import type { Step } from '../../../shared/steps'
import { droppedPaths, reel, userMessage } from '../api'
import type { Go } from '../nav'
import { Confirm, IS_MAC, PickFiles, Spinner, useFileDrop } from '../components/ui'
import { Icon } from '../components/icons'
import { PhonePlayer } from '../components/Player'
import type { SubtitleLook } from '../../../shared/caption-presets'
import { PhoneViewSwitch, usePhoneView } from '../components/Phone'
import { createPlayhead, usePlayhead, type Playhead } from '../components/playhead'
import { createTransport, useTransport, type Transport } from '../components/transport'
import { versionOnScreen, versionsShown } from '../components/videoLayers'
import { EXPORT_EVENT, NOTE_DROP_DONE, useNotify } from '../App'
import { ShowMeHow, type Tab } from './ShowMeHow'
import { useNoteAttachments } from '../components/NoteAttachments'
import { NotesLog, useVersionRows, type FirstState } from '../components/NotesLog'
import { Composer, region, type Chip } from '../components/Composer'
import { Timeline, type TimelineMark } from '../components/Timeline'
import { Outs } from '../components/Outs'
import { PopMenu } from '../components/PopMenu'
import { TitleBarSlot } from '../components/titlebar'
import { ConnectAI, ModelDownload } from '../components/connect'
import { byKeyboard, reducedMotion } from '../components/motion'
import '../components/reel.css'

const ACTION_TAB: Partial<Record<ChatAction, Tab>> = {
  'open-cut': 'cut',
  'open-captions': 'captions',
  'open-music': 'music',
  'open-broll': 'broll',
  'open-cover': 'cover',
  'open-editor': 'cut'
}

const NOTIFY_ASKED = 'rs.notify-asked'
const pinsKey = (slug: string): string => `rs.pins.${slug}`
/** After closing something from the keyboard, focus lands on the timeline rather than the page. */
const keyboardBackToTimeline = (): void => {
  if (byKeyboard()) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-testid="timeline"]')?.focus())
}
const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}
// How long a landed version's line keeps its entering state, so a re-render soon after does not replay it.
const LANDED_MS = 1500
// The landing crossfade (reel.css, 200 ms) stays armed until the new version is on screen, plus the fade.
const FADE_DONE_MS = 300

/** A spot someone pointed at on the picture, kept on this computer with its note. */
interface Pin {
  n: number
  at: number
  x: number
  y: number
  text: string
}

/**
 * The reel: the video at full height on the stage with its timeline and transport under it, and the notes for the
 * editor in a column on the right. Version 1 is made here, a reel with no video is planned here, and Edit it myself
 * takes the column's place.
 */
export function Reel({ slug, go }: { slug: string; go: Go }) {
  const notify = useNotify()
  const [d, setD] = useState<ProjectDetail | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  // A version picked to watch plays with sound. The player clears the request once it has started.
  const [playRequest, setPlayRequest] = useState<{ n: number; ask: number } | null>(null)
  const playAsks = useRef(0)
  // The running job, folded from its events (shared/live.ts). null = nothing running.
  const [job, setJob] = useState<LiveState | null>(null)
  const [firstSteps, setFirstSteps] = useState<Step[] | null>(null)
  const [heard, setHeard] = useState<string[]>([])
  // what a note's job has said it was doing, in order, for Steps
  const [steps, setSteps] = useState<string[]>([])
  const [drawer, setDrawer] = useState<Tab | null>(null)
  // the waiting hand edit Edit it myself is changing (its Edit in the log), or null for a new one
  const [handId, setHandId] = useState<string | null>(null)
  const [stage, setStage] = useState<HTMLElement | null>(null)
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [providerChecked, setProviderChecked] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [more, setMore] = useState(false)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const [phoneView, setPhoneView] = usePhoneView()
  const [holding, setHolding] = useState(false)
  const [warmOriginal, setWarmOriginal] = useState(false)
  const [preview, setPreview] = useState<{ look: SubtitleLook; text: string; at: number } | null>(null)
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null)
  const [landed, setLanded] = useState<number | null>(null)
  const [unwatched, setUnwatched] = useState<number | null>(null)
  // the version whose arrival crosses over the one on screen
  const [landing, setLanding] = useState<number | null>(null)
  const [pointing, setPointing] = useState(false)
  const [pins, setPins] = useState<Pin[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(pinsKey(slug)) ?? '[]') as Pin[]
    } catch {
      return []
    }
  })
  const [playhead] = useState(createPlayhead)
  const [transport] = useState(createTransport)
  const { duration } = useTransport(transport)
  const player = useMemo(
    () => ({
      playhead,
      seek: (t: number, play?: boolean) => {
        transport.seek(t)
        if (play && !transport.get().playing) transport.toggle()
      },
      playing: () => transport.get().playing,
      stage
    }),
    [playhead, transport, stage]
  )
  const [shownSrc, setShownSrc] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [chip, setChip] = useState<Chip>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const [notifyAsk, setNotifyAsk] = useState(false)
  const noteField = useRef<HTMLTextAreaElement>(null)
  const [answerError, setAnswerError] = useState<{ id: string; text: string } | null>(null)
  const att = useNoteAttachments(slug, notify)
  // Files dropped on the note box before the editor check answers: attached once it does, as any drop is.
  const heldDrops = useRef<{ files: File[]; types: string[] }[]>([])
  const [heldN, setHeldN] = useState(0)
  useEffect(() => {
    if (!providerChecked || !heldDrops.current.length) return
    for (const drop of heldDrops.current) att.onDropFiles(drop)
    heldDrops.current = []
    setHeldN(0)
  }, [providerChecked, att.onDropFiles])
  const versionRows = useVersionRows(slug)
  const lastJob = useRef<string | null>(null)
  const nowStep = useRef(-1)
  // read in the job listener, which is set up once
  const watching = useRef({ compare: false, drawer: false })
  watching.current = { compare: !!compare, drawer: !!drawer }

  // Reads overlap (a job's first status and its end each ask): only the newest read may land, and a read
  // that asked to show the newest version passes that on to whichever read lands.
  const loads = useRef(0)
  const wantLatest = useRef(false)
  const load = useCallback(
    async (selectLatest = false) => {
      const n = ++loads.current
      if (selectLatest) wantLatest.current = true
      try {
        const got = await reel.projects.get(slug)
        if (n !== loads.current) return null
        // a preview is a first look until the first edit is done, and the reel's version during any other job
        const next = { ...got, versions: versionsShown(got) }
        selectLatest = wantLatest.current
        wantLatest.current = false
        setD(next)
        if (next.job) {
          setJob((cur) => (cur?.jobId === next.job!.id ? cur : liveFromDetail(next.job!)))
          if (next.job.steps) setFirstSteps(next.job.steps)
        } else setJob(null)
        if (next.words.length) setHeard((h) => (h.length ? h : next.words.map((w) => w.w)))
        const latest = next.versions[next.versions.length - 1]?.n ?? null
        setSelected((cur) => (selectLatest || cur === null || !next.versions.some((v) => v.n === cur) ? latest : cur))
        return next
      } catch (e) {
        if (n !== loads.current) return null
        notify(userMessage(e), 'error')
        go({ name: 'home' })
        return null
      }
    },
    [slug, go, notify]
  )

  const play = useCallback((n: number) => setPlayRequest({ n, ask: ++playAsks.current }), [])

  /** A version landed: it takes the screen and plays, unless the person is comparing or editing by hand. */
  const land = useCallback(
    async (n: number | undefined) => {
      const busyElsewhere = watching.current.compare || watching.current.drawer
      const next = await load(!busyElsewhere)
      const v = n ?? next?.versions[next.versions.length - 1]?.n
      if (v === undefined) return
      setLanded(v)
      window.setTimeout(() => setLanded((l) => (l === v ? null : l)), LANDED_MS)
      if (busyElsewhere) return setUnwatched(v)
      if (!byKeyboard() && !reducedMotion()) {
        setLanding(v)
        // a version that never takes the screen (it was already on it) must not leave the crossfade armed
        window.setTimeout(() => setLanding((l) => (l === v ? null : l)), 10_000)
      }
      play(v)
    },
    [load, play]
  )

  // a New reel left untouched goes (main/store.ts isUntouchedPlanned)
  useEffect(() => () => void reel.projects.leave(slug).catch(() => {}), [slug])

  useEffect(() => {
    void load(true)
    reel.ai
      .active()
      .then(setProvider)
      .catch(() => {})
      .finally(() => setProviderChecked(true))
    const offAi = reel.ai.onChange(setProvider)
    const offQueue = reel.queue.onChange((s) => s === slug && void load())
    const offJobs = reel.jobs.onEvent((e) => {
      if (e.slug !== slug) return
      // a waiting note just started: its words move from the queue into the notes
      if (e.type === 'status' && lastJob.current !== e.jobId) {
        lastJob.current = e.jobId
        nowStep.current = -1
        void load()
      }
      if (e.type === 'status' || e.type === 'reply' || e.type === 'tool') setJob((cur) => reduceLive(cur ?? EMPTY_LIVE, e))
      if (e.type === 'status' && e.steps) {
        setFirstSteps(e.steps)
        // a new step: the copy, then the transcript, are on disk now
        const at = e.steps.findIndex((s) => s.state === 'now')
        if (at !== nowStep.current) {
          nowStep.current = at
          void load()
        }
      } else if (e.type === 'heard') setHeard(e.words)
      else if (e.type === 'render' && e.draft) {
        setJob((cur) => reduceLive(cur ?? EMPTY_LIVE, e))
        void load()
      } else if (e.type === 'done') {
        setJob(null)
        setFirstSteps(null)
        // an export or a script ends with no new version
        void (e.version === undefined ? load() : land(e.version))
      } else if (e.type === 'error' || e.type === 'cancelled' || e.type === 'paused') {
        setJob(null)
        setFirstSteps(null)
        void load()
      }
    })
    return () => {
      offAi()
      offQueue()
      offJobs()
    }
  }, [slug, load, land])

  useEffect(() => {
    if (!job?.jobId) {
      setSteps([])
      return
    }
    const m = job.message
    if (m === EMPTY_LIVE.message) return
    setSteps((s) => (s[s.length - 1] === m ? s : [...s, m]))
  }, [job?.jobId, job?.message])

  const firstEditRunning = d?.job?.kind === 'first-edit'
  useEffect(() => {
    if (!firstEditRunning || localStorage.getItem(NOTIFY_ASKED)) return
    let live = true
    reel.perm
      .status()
      .then((s) => live && setNotifyAsk(s.notifications === 'off'))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [firstEditRunning])

  const version = d ? (d.versions.find((v) => v.n === selected) ?? d.versions[d.versions.length - 1]) : undefined
  const changePreview = job?.preview && d?.versions.length ? job.preview.video : null
  const [timeline, setTimeline] = useState<{ video: string; words: PlacedWord[]; segments: RenderSegment[] | null } | null>(null)
  const onScreen = d ? versionOnScreen(d.versions, shownSrc) : null
  const shownN = onScreen?.n
  const shownVideo = onScreen?.video
  useEffect(() => {
    if (shownN === undefined || !shownVideo) return
    let live = true
    reel.projects
      .timeline(slug, shownN)
      .then((t) => {
        if (live) setTimeline({ video: shownVideo, words: t?.words ?? [], segments: t?.segments ?? null })
      })
      .catch((e) => {
        if (live) setTimeline({ video: shownVideo, words: [], segments: null })
        notify(userMessage(e), 'error')
      })
    return () => {
      live = false
    }
  }, [slug, shownN, shownVideo, notify])

  const latestN = d?.versions[d.versions.length - 1]?.n
  const older = version && version.n !== latestN ? version : null

  const aiOff = providerChecked && (!provider || !provider.connected || provider.id === 'none')
  const canPoint = !!version && !aiOff && !compare && !drawer

  // Hold O for the original; C points at a spot; Esc stops pointing, then comparing.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || document.querySelector('.modal-backdrop')) return
      const k = e.key.toLowerCase()
      if (k === 'o' && !e.repeat) setHolding(true)
      else if (k === 'c' && !e.repeat && canPoint) setPointing((p) => !p)
      else if (e.key === 'Escape' && pointing) (setPointing(false), keyboardBackToTimeline())
      else if (e.key === 'Escape' && compare) (setCompare(null), keyboardBackToTimeline())
      else return
      e.preventDefault()
    }
    const up = (e: KeyboardEvent) => e.key.toLowerCase() === 'o' && setHolding(false)
    const away = () => setHolding(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', away)
    }
  }, [canPoint, pointing, compare])

  const entries = useMemo(
    () =>
      d
        ? notesLog({
            chat: d.chat,
            made: d.versionsMade,
            versions: d.versions,
            running: d.job
              ? d.job.kind === 'export'
                ? null
                : { id: d.job.id, kind: d.job.kind === 'rerender' ? 'hand' : d.job.kind === 'first-edit' ? 'first-edit' : d.job.kind === 'script' ? 'script' : 'note' }
              : null,
            planned: d.status === 'planned',
            source: d.project.sources?.[0] ?? null,
            now: new Date()
          })
        : [],
    [d]
  )

  const marks = useMemo((): TimelineMark[] => {
    if (!d || !timeline || timeline.video !== shownVideo) return []
    const made = new Map(entries.flatMap((e) => (e.result?.kind === 'version' ? [[e.key, e.result.v] as const] : [])))
    const out: TimelineMark[] = noteMarks(d.chat, job?.jobId ?? null, timeline.words)
      .filter((m) => m.state === 'making' || (m.state === 'done' && made.has(m.id)))
      .map((m) => ({ id: m.id, at: m.at, text: m.text, ...(m.state === 'done' ? { v: made.get(m.id) } : {}) }))
    for (const q of d.queue) if (!q.attempt && q.moment && q.moment.version === shownN) out.push({ id: q.id, at: q.moment.at, text: q.text })
    return out
  }, [d, timeline, shownVideo, shownN, entries, job?.jobId])

  if (!d)
    return (
      <div className="page">
        <Spinner />
      </div>
    )

  const planned = d.status === 'planned'
  const hasVersions = d.versions.length > 0
  const computer = IS_MAC ? 'Mac' : 'PC'
  // paused without you (shared/pause.ts): why, and when it goes on by itself
  const pausedWhy = d.pausedFor ? pausedSentence(d.pausedFor, new Date(), computer) : null
  const heldWords = d.pausedFor ? pausedWords(d.pausedFor, new Date(), computer) : null
  const heldWhy = heldWords && heldWords[0].toLowerCase() + heldWords.slice(1)
  const connect = () => go({ name: 'connect', back: { name: 'reel', slug } })
  const making = job && d.job && d.job.kind !== 'export' && d.job.kind !== 'script' ? (latestN ?? 0) + 1 : null
  const first: FirstState | null =
    hasVersions || planned
      ? null
      : d.job?.kind === 'first-edit' || d.status === 'new'
        ? { kind: 'making', heard: firstSteps?.some((s) => s.id === 'listen' && s.state === 'done') ? heard : [], editor: !aiOff }
        : d.status === 'failed'
          ? { kind: 'failed', why: d.lastError?.userMessage ?? 'This version could not be made.', extra: d.lastError?.code === 'MODEL_MISSING' ? <ModelDownload secondary /> : undefined }
          : { kind: 'paused', why: pausedWhy }
  const firstLook = first?.kind === 'making' ? (job?.preview?.video ?? null) : null

  const note = async (text: string, files: string[] | undefined, moment: NoteMoment | undefined) => {
    const r = await reel.projects.note(slug, text, files, moment, version?.n)
    if (r.jobId) setJob((cur) => (cur?.jobId === r.jobId ? cur : { ...EMPTY_LIVE, jobId: r.jobId, message: 'Reading your note' }))
    await load()
  }

  /** The words on screen at the chip's moment or range in the version shown, or why a note can't point there. */
  const momentFor = async (c: NonNullable<Chip>): Promise<NoteMoment | string> => {
    const n = onScreen?.n ?? version?.n
    const tl = n !== undefined ? await reel.projects.timeline(slug, n).catch(() => null) : null
    if (!tl || n === undefined) return NO_TIMELINE
    if (c.at > tl.duration) return `There's no ${clock(c.at)} in this reel. It's ${clock(tl.duration)} long.`
    const words = c.to !== undefined ? wordsBetween(tl.words, c.at, c.to) : wordsAt(tl.words, c.at)
    return words.length ? noteMoment(c.at, n, words, c.to) : noSpeech(c.at)
  }

  const send = async () => {
    const text = draft.trim()
    const files = att.chips
    if ((!text && !files.length) || att.busy || !providerChecked) return
    setAlert(null)
    if (planned) {
      setDraft('')
      try {
        const r = await reel.projects.script(slug, text)
        setJob({ ...EMPTY_LIVE, jobId: r.jobId, message: 'Writing your script' })
        await load()
      } catch (e) {
        setDraft(text)
        setAlert(userMessage(e))
      }
      return
    }
    let moment: NoteMoment | undefined
    if (chip) {
      const m = await momentFor(chip)
      if (typeof m === 'string') return setAlert(m)
      moment = m
    }
    const spot = chip?.spot
    // the editor reads where the spot is in words; the note says it the way a person would
    const where = spot && (region(spot.x, spot.y) === 'the middle' ? 'in the middle of the picture' : `at the ${region(spot.x, spot.y)} of the picture`)
    const words = where ? `${(text || 'Change this').replace(/[.!?]+$/, '')}, ${where}.` : text
    setDraft('')
    setChip(null)
    att.clear()
    try {
      await note(words || 'Put this here', files.length ? files.map((f) => f.asset) : undefined, moment)
      if (spot && chip) {
        const next = [...pins, { n: spot.n, at: chip.at, x: spot.x, y: spot.y, text: text || 'Change this' }]
        localStorage.setItem(pinsKey(slug), JSON.stringify(next))
        setPins(next)
      }
    } catch (e) {
      setDraft(text)
      setChip(chip)
      att.restore(files)
      setAlert(userMessage(e))
    }
  }

  const retry = (e: LogEntry) => {
    if (e.ask.kind !== 'note') return
    // a note that didn't finish waits at the head of the queue, with its moment and files: run it again
    const kept = d.queue.some((q) => q.id === e.key)
    const r = planned
      ? reel.projects.script(slug, e.ask.text).then(() => load())
      : kept
        ? reel.queue.runNext(slug)
        : note(e.ask.text, undefined, e.ask.moment ?? undefined)
    void r.catch((err) => setAlert(userMessage(err)))
  }

  const rename = async () => {
    const t = (renaming ?? '').trim()
    setRenaming(null)
    if (!t || t === d.title) return
    try {
      await reel.projects.update(slug, { title: t })
      await load()
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  const resume = async (basic = false) => {
    try {
      const r = await reel.projects.resume(slug, basic)
      setJob({ ...EMPTY_LIVE, jobId: r.jobId })
      await load()
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  const addVideo = async (paths: string[]) => {
    try {
      const r = await reel.projects.addVideo(slug, paths)
      setJob({ ...EMPTY_LIVE, jobId: r.jobId, message: 'Copying your video' })
      await load()
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  const savePost = async (text: string): Promise<boolean> => {
    const caption = text.trim()
    if (caption === (d.project.post?.caption ?? '').trim()) return true
    try {
      await reel.projects.update(slug, { post: { keywords: [], ...(d.project.post ?? {}), caption, hashtags: [] } })
      await load()
      return true
    } catch (e) {
      notify(userMessage(e), 'error')
      return false
    }
  }

  const originalReady = !shownVideo || timeline?.video === shownVideo
  const originalAt = (t: number) => {
    if (!shownVideo) return 'start' as const
    if (timeline?.video !== shownVideo) return null
    if (!timeline.segments) return 'start' as const
    const at = sourceAt(timeline.segments, t)
    const src = at && d.sourceVideos[at.source]
    return src ? { src, at: at.at } : null
  }

  const runAction = (a: ChatAction, messageId: string) => {
    if (a === 'remember-yes' || a === 'remember-no') {
      reel.style
        .answer(slug, messageId, a === 'remember-yes')
        .then(async () => {
          setAnswerError(null)
          await load()
          // the buttons are gone: keep focus on the answered question, not lost to the page
          document.getElementById(`msg-${messageId}`)?.focus()
        })
        .catch((e) => setAnswerError({ id: messageId, text: userMessage(e) }))
    } else if (a === 'connect') connect()
    else if (a === 'open-post') window.dispatchEvent(new Event(EXPORT_EVENT))
    else openDrawer(ACTION_TAB[a] ?? 'cut')
  }
  // "Edit it myself" changes the newest version: with an older one on screen, show the newest first.
  const openDrawer = (t: Tab, hand: string | null = null) => {
    if (older && latestN !== undefined) setSelected(latestN)
    setCompare(null)
    setPointing(false)
    setHandId(hand)
    setDrawer(t)
  }
  const watch = (n: number) => {
    setCompare(null)
    setSelected(n)
    if (unwatched === n) setUnwatched(null)
    if (!changePreview) play(n)
  }
  const startCompare = (b: number) => {
    const i = d.versions.findIndex((v) => v.n === b)
    if (i < 1) return
    setPointing(false)
    setCompare({ a: d.versions[i - 1].n, b })
    setSelected(b)
  }

  // Share's own work (a preview made full quality, other platforms) shows on the Share button, not in the note box
  const shareWork = d.job?.kind === 'export' && d.job.id === job?.jobId
  // comparing and Edit it myself stay on the versions they show; a running job's preview waits (B section 5, step 3)
  const jobPreview = compare || drawer ? null : changePreview
  const src = planned ? null : hasVersions ? (jobPreview ?? version?.video ?? null) : (firstLook ?? d.sourceVideo)
  const tag = jobPreview ? 'Quick preview' : !hasVersions && !planned && src ? (firstLook ? 'First look' : 'Original') : null
  const waiting = d.queue.filter((q) => !q.attempt).length
  const nextSpot = Math.max(0, ...pins.map((p) => p.n)) + 1
  const placeholder = planned
    ? "What's this reel about?"
    : !hasVersions
      ? 'Notes you send now wait for Version 1…'
      : job
        ? 'Your next note waits for this one…'
        : 'Tell your editor what to change…'
  const showComposer = planned || hasVersions || first?.kind === 'making'

  // A version's name: the AI's rewording when it passed the check against what changed, else the app's own (#60).
  const nameOf = (v: VersionInfo): string => v.wording?.title ?? (v.facts ? versionTitle(v.facts, d.words) : '')
  const tagged = onScreen ?? version
  const taggedName = tagged ? nameOf(tagged) : ''

  const title = (
    <span className="rt-title">
      {renaming === null ? (
        <h1
          className="tb-h reel-title"
          title="Click to rename"
          role="button"
          tabIndex={0}
          onClick={() => setRenaming(d.title)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setRenaming(d.title))}
          data-testid="title"
        >
          {d.title}
        </h1>
      ) : (
        <input
          className="input reel-title-input"
          autoFocus
          value={renaming}
          aria-label="Reel name"
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => void rename()}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void rename()
            if (e.key === 'Escape') setRenaming(null)
          }}
          data-testid="title-input"
        />
      )}
      {tagged && (
        <span className={`rt-ver${older ? ' older' : ''}`} data-testid="version-on-screen">
          Version {tagged.n}
        </span>
      )}
      {taggedName && (
        <span className="rt-ver-name" title={taggedName} data-testid="version-title">
          {taggedName}
        </span>
      )}
      {older && !compare && (
        <button className="btn ghost small" onClick={() => watch(latestN!)} data-testid="version-latest">
          Back to latest
        </button>
      )}
    </span>
  )

  const actions = (
    <>
      {hasVersions && (
        <button className={`btn ghost${drawer ? ' on' : ''}`} aria-pressed={!!drawer} onClick={() => (drawer ? (setDrawer(null), setHandId(null), setPreview(null)) : openDrawer('cut'))} data-testid="edit-myself">
          <Icon name="sliders" size={16} /> Edit it myself
        </button>
      )}
      {hasVersions && (
        <Outs
          slug={slug}
          version={version}
          versions={d.versions}
          post={d.project.post}
          disabled={!version || (!!job && !shareWork)}
          quiet={!!compare || !!drawer || aiOff}
          why={job ? 'Wait for this version to finish.' : undefined}
          onSaveCaption={savePost}
        />
      )}
      <span className="rt-more">
        <button
          ref={moreBtn}
          className="icon-btn"
          aria-label="More for this reel"
          aria-haspopup="menu"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
          data-testid="more"
        >
          <Icon name="more" />
        </button>
        <PopMenu open={more} onClose={() => setMore(false)} anchor={moreBtn} label="More for this reel" style={{ right: 0, top: 'calc(100% + 6px)', width: 200 }} origin="top right">
          <button className="mi" role="menuitem" onClick={() => (setMore(false), setRenaming(d.title))} data-testid="rename">
            <Icon name="pencil" size={16} /> Rename
          </button>
          <button className="mi danger" role="menuitem" disabled={!!job} onClick={() => (setMore(false), setConfirmDelete(true))} data-testid="delete">
            <Icon name="trash" size={16} /> Delete…
          </button>
        </PopMenu>
      </span>
    </>
  )

  const over = (
    <div className="reel-over">
      {drawer && <div className="edit-stage" ref={setStage} />}
      {tag && (
        <span className="reel-tag" data-testid={jobPreview ? 'change-preview' : 'first-tag'}>
          {tag}
        </span>
      )}
      {compare && (
        <div className="cmp" role="group" aria-label="Compare versions" data-testid="compare">
          <div className="abswitch">
            {[compare.a, compare.b].map((n) => (
              <button key={n} className={selected === n ? 'on' : undefined} aria-pressed={selected === n} onClick={() => setSelected(n)} data-testid={`compare-pick-${n}`}>
                Version {n}
              </button>
            ))}
          </div>
          <button className="cmp-done" onClick={() => (setCompare(null), keyboardBackToTimeline())} data-testid="done-compare">
            Done comparing
          </button>
        </div>
      )}
      {!compare && <Spots pins={pins} playhead={playhead} />}
      {chip?.spot && (
        <span className="spot pending" style={{ left: `${chip.spot.x * 100}%`, top: `${chip.spot.y * 100}%` }} aria-hidden>
          {chip.spot.n}
        </span>
      )}
      {pointing && (
        <Pointer
          playhead={playhead}
          onCancel={() => (setPointing(false), keyboardBackToTimeline())}
          onDrop={(x, y) => {
            if (transport.get().playing) transport.toggle()
            setPointing(false)
            setChip({ at: Math.floor(playhead.get()), spot: { x, y, n: nextSpot } })
            noteField.current?.focus()
          }}
        />
      )}
    </div>
  )

  return (
    <div className="reel-page" data-slug={slug}>
      <TitleBarSlot title={title} actions={actions} />
      <div className="reel-b">
        <section className="stage" aria-label="Video" onPointerEnter={() => setWarmOriginal(true)}>
          {planned ? (
            <PlannedStage title={d.title} onFiles={(p) => void addVideo(p)} />
          ) : (
            <>
              <div className="stage-v">
                <PhonePlayer
                  src={src}
                  poster={hasVersions ? version?.cover : null}
                  className={[landing !== null && 'landing', tag === 'Original' && d.project.sources?.[0]?.mirror === true && 'mirrored-original'].filter(Boolean).join(' ') || undefined}
                  autoPlayMuted={!!changePreview || !hasVersions}
                  playRequest={!changePreview && playRequest?.n === version?.n ? playRequest?.ask : undefined}
                  onPlayRequestHandled={() => setPlayRequest(null)}
                  subtitle={drawer && preview ? preview : null}
                  still={drawer && preview && d.sourceVideo ? `${d.sourceVideo}#t=${preview.at.toFixed(2)}` : null}
                  stillMirrored={d.project.sources?.[0]?.mirror === true}
                  view={phoneView}
                  caption={d.project.post?.caption}
                  original={hasVersions ? d.sourceVideo : null}
                  originalAt={originalAt}
                  originalReady={originalReady}
                  warmOriginal={warmOriginal}
                  holdingOriginal={holding}
                  onHold={hasVersions && d.sourceVideo ? setHolding : undefined}
                  dragFile={version && !version.draft ? version.videoPath : null}
                  playhead={playhead}
                  transport={transport}
                  bare
                  onShown={(shown) => {
                    setShownSrc(shown)
                    if (landing !== null && shown && shown === d.versions.find((v) => v.n === landing)?.video)
                      window.setTimeout(() => setLanding((l) => (l === landing ? null : l)), FADE_DONE_MS)
                  }}
                  keepTime={!!compare || !!drawer}
                  onFailed={() => {
                    notify('That version could not be found. It may have been moved or deleted.', 'error')
                    if (onScreen) setSelected(onScreen.n)
                  }}
                  over={over}
                >
                  <div className="phone-empty" data-testid="copying">
                    <Spinner /> Copying your video
                  </div>
                </PhonePlayer>
              </div>
              {src && (
                <>
                  <Timeline
                    playhead={playhead}
                    transport={transport}
                    duration={duration}
                    words={timeline && timeline.video === shownVideo ? timeline.words : []}
                    marks={marks}
                    onRange={(r) => {
                      if (!hasVersions || aiOff) return
                      setChip(r)
                      // from the keyboard the range keeps growing with Shift and the arrows, so focus stays put
                      if (!byKeyboard()) noteField.current?.focus()
                    }}
                    onPlay={(n) => !drawer && watch(n)}
                  />
                  <TransportRow transport={transport} playhead={playhead}>
                    <PhoneViewSwitch value={phoneView} onChange={(v) => void setPhoneView(v).catch((e) => notify(userMessage(e), 'error'))} />
                  </TransportRow>
                </>
              )}
            </>
          )}
        </section>

        <div className="ncol">
          {drawer ? (
            <ShowMeHow
              key={handId ?? 'new'}
              d={d}
              initialTab={drawer}
              version={version ?? null}
              player={player}
              queued={handId ? (d.queue.find((q) => q.id === handId) ?? null) : null}
              onClose={() => {
                setDrawer(null)
                setHandId(null)
                setPreview(null)
              }}
              onPreview={setPreview}
              onTab={(t) => setDrawer(t)}
            />
          ) : (
            <>
              <div className="notes-h">
                <h2>Notes for your editor</h2>
              </div>
              <NotesLog
                slug={slug}
                entries={entries}
                queue={d.queue}
                held={d.queueHeld}
                latest={latestN ?? 0}
                first={first}
                shown={onScreen?.n ?? null}
                making={making}
                busy={!!job}
                aiOn={!aiOff}
                basic={!d.aiEdited}
                landed={landed}
                unwatched={unwatched}
                empty={
                  planned && (
                    <p className="log-empty" data-testid="plan-empty">
                      Haven't filmed it yet? Tell your editor what it's about and get a script.
                    </p>
                  )
                }
                versionRows={versionRows}
                onPlay={watch}
                onCompare={startCompare}
                onAction={runAction}
                onRetry={retry}
                onEditHand={(id) => openDrawer('cut', id)}
                onResume={() => void resume()}
                onBasic={() => void resume(true)}
                onCopy={(t) => void reel.app.copyText(t).then(() => notify('Copied.'))}
                onError={(m) => notify(m, 'error')}
                answerError={answerError}
                pausedWhy={pausedWhy}
              />
              {showComposer && (
                <div
                  className="cwrap"
                  data-testid="composer-wrap"
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes('Files')) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }}
                  {...(planned && { 'data-video-drop': true })}
                  onDrop={(e) => {
                    if (!Array.from(e.dataTransfer.types).includes('Files')) return
                    if (planned) {
                      e.preventDefault()
                      e.stopPropagation()
                      window.dispatchEvent(new Event(NOTE_DROP_DONE))
                      const paths = droppedPaths(e)
                      if (paths.length) void addVideo(paths)
                      return
                    }
                    if (aiOff) return
                    e.preventDefault()
                    e.stopPropagation()
                    window.dispatchEvent(new Event(NOTE_DROP_DONE))
                    if (!providerChecked) {
                      heldDrops.current.push({ files: Array.from(e.dataTransfer.files), types: Array.from(e.dataTransfer.types) })
                      setHeldN(heldDrops.current.length)
                      return
                    }
                    att.onDropFiles(e.dataTransfer)
                  }}
                >
                  <Composer
                    draft={draft}
                    onDraft={setDraft}
                    chip={chip}
                    onChip={setChip}
                    onPoint={() => canPoint && setPointing(true)}
                    plain={!hasVersions}
                    playhead={playhead}
                    att={heldN ? { ...att, busy: att.busy + heldN } : att}
                    checking={!providerChecked}
                    placeholder={placeholder}
                    job={shareWork ? null : job}
                    making={making}
                    firstSteps={first?.kind === 'making' ? firstSteps : null}
                    steps={steps}
                    stepsOpenFirst={first?.kind === 'making'}
                    stepNote={job ? d.chat.find((m) => m.from === 'you' && m.jobId === job.jobId) : null}
                    under={
                      first?.kind === 'making' &&
                      notifyAsk && (
                        <p className="notify-ask" data-testid="notify-ask">
                          This takes a few minutes.{' '}
                          <button
                            onClick={() => {
                              localStorage.setItem(NOTIFY_ASKED, '1')
                              setNotifyAsk(false)
                              void reel.perm.setNotifications(true).catch((e) => notify(userMessage(e), 'error'))
                            }}
                            data-testid="notify-me"
                          >
                            Notify me when it's ready
                          </button>
                        </p>
                      )
                    }
                    held={d.queueHeld ? waiting : 0}
                    heldWhy={heldWhy}
                    alert={alert}
                    connect={
                      aiOff ? (
                        <div className="connect-cin" data-testid="composer-connect">
                          <p>{planned ? 'Connect an editor to get a script' : 'Connect an editor to leave notes'}</p>
                          <ConnectAI onConnected={setProvider} />
                        </div>
                      ) : null
                    }
                    onSend={() => void send()}
                    onStop={() => job?.jobId && void reel.jobs.cancel(job.jobId)}
                    onRunNext={() => void reel.queue.runNext(slug).catch((e) => notify(userMessage(e), 'error'))}
                    onClear={() => void reel.queue.clear(slug).catch((e) => notify(userMessage(e), 'error'))}
                    inputRef={noteField}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <Confirm
          title="Delete this reel?"
          body="This removes the reel and all its versions from Reel Studio. Anything you shared stays where you put it."
          yes="Delete"
          no="Keep it"
          danger
          onNo={() => setConfirmDelete(false)}
          onYes={async () => {
            await reel.projects.remove(slug).catch((e) => notify(userMessage(e), 'error'))
            go({ name: 'home' })
          }}
        />
      )}

    </div>
  )
}

/** Play, the time, then whatever sits at the row's end (speed, Instagram or Clean). */
function TransportRow({ transport, playhead, children }: { transport: Transport; playhead: Playhead; children: React.ReactNode }) {
  const { playing, duration, rate } = useTransport(transport)
  const second = usePlayhead(playhead, Math.floor)
  return (
    <div className="transport">
      <button className="pp" onClick={() => transport.toggle()} aria-label={playing ? 'Pause' : 'Play'} data-testid="play">
        <Icon name={playing ? 'pause' : 'play'} size={14} stroke={2} />
      </button>
      <span className="tc" data-testid="time">
        {clock(second)} <span>/ {clock(duration)}</span>
      </span>
      <span className="sp" />
      <button className={`speed${rate !== 1 ? ' on' : ''}`} onClick={() => transport.nextRate()} aria-label={`Playback speed ${rate}×`} title="Playback speed" data-testid="speed">
        {rate}×
      </button>
      {children}
    </div>
  )
}

/** Spots on the picture show again within 1.5 s of their moment. */
function Spots({ pins, playhead }: { pins: Pin[]; playhead: Playhead }) {
  const t = usePlayhead(playhead, (s) => Math.round(s * 4) / 4)
  if (!pins.length) return null
  return (
    <>
      {pins.map((p) => {
        const near = Math.abs(t - p.at) <= 1.5
        return (
          <span key={p.n} className={`spot${near ? '' : ' away'}${p.x > 0.55 ? ' flip' : ''}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--room': p.x > 0.55 ? p.x : 1 - p.x } as React.CSSProperties} aria-hidden>
            {p.n}
            {near && <span className="spot-lab">{p.text}</span>}
          </span>
        )
      })}
    </>
  )
}

/** Point at a spot (C): a ring follows the pointer and a click drops the numbered spot. Arrows and Enter do the same. */
function Pointer({ playhead, onDrop, onCancel }: { playhead: Playhead; onDrop: (x: number, y: number) => void; onCancel: () => void }) {
  const layer = useRef<HTMLDivElement>(null)
  const [ring, setRing] = useState<{ x: number; y: number } | null>(() => (byKeyboard() ? { x: 0.5, y: 0.4 } : null))
  const second = usePlayhead(playhead, Math.floor)
  useEffect(() => layer.current?.focus({ preventScroll: true }), [])
  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = layer.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }
  return (
    <div
      ref={layer}
      className="pointer"
      tabIndex={0}
      role="application"
      aria-label="Point at the spot you mean. The arrow keys move, Enter drops the spot, Escape stops."
      onPointerMove={(e) => setRing(at(e))}
      onClick={(e) => {
        e.stopPropagation()
        const p = at(e)
        onDrop(p.x, p.y)
      }}
      onKeyDown={(e) => {
        const d = ({ ArrowLeft: [-0.04, 0], ArrowRight: [0.04, 0], ArrowUp: [0, -0.04], ArrowDown: [0, 0.04] } as Record<string, number[]>)[e.key]
        const r = ring ?? { x: 0.5, y: 0.4 }
        if (d) setRing({ x: Math.min(0.96, Math.max(0.04, r.x + d[0])), y: Math.min(0.96, Math.max(0.04, r.y + d[1])) })
        else if (e.key === 'Enter') onDrop(r.x, r.y)
        else if (e.key === 'Escape') onCancel()
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
      data-testid="pointer"
    >
      <span className="pointer-hint">Click the spot you mean</span>
      {ring && (
        <span className="ring" style={{ left: `${ring.x * 100}%`, top: `${ring.y * 100}%` }} aria-hidden>
          <span className="rt">{clock(second)}</span>
        </span>
      )}
    </div>
  )
}

/** A reel with no video yet: its title set large where the video will be, and the one way to add it. */
function PlannedStage({ title, onFiles }: { title: string; onFiles: (paths: string[]) => void }) {
  const drop = useFileDrop((paths) => {
    window.dispatchEvent(new Event(NOTE_DROP_DONE))
    onFiles(paths)
  })
  return (
    <div className={`planned${drop.over ? ' over' : ''}`} {...drop.props} data-video-drop data-testid="planned-stage">
      <div className="planned-frame">
        <p className="planned-title">{title}</p>
        <div className="planned-ask">
          <h2>Drop the video you filmed</h2>
          <p>A few takes are fine. Retakes and pauses come out.</p>
          <PickFiles className="btn primary" label="Choose video" accept="video/*,.mov,.mp4,.m4v" onFiles={onFiles} />
        </div>
      </div>
    </div>
  )
}
