import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAction, ExportResult, NoteMoment, PlacedWord, ProjectDetail, ProviderInfo } from '../../../shared/api'
import { clock } from '../../../shared/progress'
import { EMPTY_LIVE, liveFromDetail, reduceLive, type LiveState } from '../../../shared/live'
import { noteMarks, noteMoment, sourceAt, wordsAt, type RenderSegment } from '../../../shared/moments'
import { notesLog } from '../../../shared/notes-log'
import { versionChanges } from '../../../shared/versions'
import { reel, userMessage } from '../api'
import type { Go } from '../nav'
import { Confirm, FOLDER_APP, Modal, Spinner } from '../components/ui'
import { SendToPhone } from '../components/SendToPhone'
import { CloudSave } from '../components/CloudSave'
import { PlatformExportDialog } from '../components/PlatformExportDialog'
import { Icon } from '../components/icons'
import { PhonePlayer } from '../components/Player'
import type { SubtitleLook } from '../../../shared/caption-presets'
import { PhoneViewSwitch, usePhoneView } from '../components/Phone'
import { createPlayhead } from '../components/playhead'
import { versionOnScreen } from '../components/videoLayers'
import { EXPORT_EVENT, NOTE_DROP_DONE, useNotify } from '../App'
import { ShowMeHow, type Tab } from './ShowMeHow'
import { useNoteAttachments } from '../components/NoteAttachments'
import { NotesLog, useVersionRows } from '../components/NotesLog'
import { Composer, type Chip } from '../components/Composer'
import { VersionPicker } from '../components/VersionsSheet'
import { Outs } from '../components/Outs'
import { PopMenu } from '../components/PopMenu'
import { usePresence } from '../components/motion'
import { ZoomView, region, type Pin } from '../components/ZoomView'
import '../components/reel.css'

const ACTION_TAB: Partial<Record<ChatAction, Tab>> = {
  'open-cut': 'cut',
  'open-captions': 'captions',
  'open-music': 'music',
  'open-broll': 'broll',
  'open-cover': 'cover',
  'open-post': 'post',
  'open-editor': 'cut'
}

// What a manual change is called while it is being made (grandma 2: a colour change said "Adding pictures").
const CHANGE_LABEL: Record<Tab, string> = {
  cut: 'Updating your cut',
  captions: 'Updating your subtitles',
  music: 'Updating your music',
  broll: 'Updating your pictures',
  cover: 'Updating your cover',
  post: 'Updating your video'
}

const INSTAGRAM_URL = 'https://www.instagram.com/'
const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const pinsKey = (slug: string): string => `rs.pins.${slug}`

const noWords = (at: number) =>
  `I can't tell which words play at ${clock(at)}. Pick a moment where you're talking, or remove the time to ask about the whole reel.`
const NO_TIMELINE = "I can't tell which words play in this version. Remove the time to ask about the whole reel, or switch to your newest version."

export function Reel({ slug, go, fresh }: { slug: string; go: Go; fresh?: boolean }) {
  const notify = useNotify()
  const [d, setD] = useState<ProjectDetail | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  // A version picked to watch plays with sound. The player clears the request once it has started.
  const [playRequest, setPlayRequest] = useState<{ n: number; ask: number } | null>(null)
  const playAsks = useRef(0)
  // Arriving from Working, the latest version plays muted, until the person picks a version.
  const [freshPlay, setFreshPlay] = useState(!!fresh)
  // The running job (a note, a re-render), folded from its events (shared/live.ts). null = nothing running.
  const [job, setJob] = useState<LiveState | null>(null)
  // what the running job has said it was doing, in order, for Steps
  const [steps, setSteps] = useState<string[]>([])
  const [drawer, setDrawer] = useState<Tab | null>(null)
  const [exporting, setExporting] = useState<'busy' | ExportResult | null>(null)
  const [platformPicker, setPlatformPicker] = useState(false)
  const [phoneFirst, setPhoneFirst] = useState(false)
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [providerChecked, setProviderChecked] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [more, setMore] = useState(false)
  const moreBtn = useRef<HTMLButtonElement>(null)
  const [stopAsk, setStopAsk] = useState(false)
  const [phoneView, setPhoneView] = usePhoneView()
  const [holding, setHolding] = useState(false)
  const [warmOriginal, setWarmOriginal] = useState(false)
  const [preview, setPreview] = useState<{ look: SubtitleLook; text: string; at: number } | null>(null)
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null)
  const [zoom, setZoom] = useState(false)
  const [pins, setPins] = useState<Pin[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(pinsKey(slug)) ?? '[]') as Pin[]
    } catch {
      return []
    }
  })
  const [playhead] = useState(createPlayhead)
  const [shownSrc, setShownSrc] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [chip, setChip] = useState<Chip>(null)
  const [alert, setAlert] = useState<string | null>(null)
  const noteField = useRef<HTMLTextAreaElement>(null)
  const [answerError, setAnswerError] = useState<{ id: string; text: string } | null>(null)
  const att = useNoteAttachments(slug, notify)
  // Files dropped on the note box before the AI check answers: attached once it does, as any drop is.
  const heldDrops = useRef<{ files: File[]; types: string[] }[]>([])
  const [heldN, setHeldN] = useState(0)
  useEffect(() => {
    if (!providerChecked || !heldDrops.current.length) return
    for (const drop of heldDrops.current) att.onDropFiles(drop)
    heldDrops.current = []
    setHeldN(0)
  }, [providerChecked, att.onDropFiles])
  const versionRows = useVersionRows(slug)
  // one export per version: a cloud save after Export reuses the file
  const exports = useRef(new Map<number, ExportResult>())
  const lastJob = useRef<string | null>(null)

  const load = useCallback(
    async (selectLatest = false) => {
      try {
        const next = await reel.projects.get(slug)
        setD(next)
        if (next.job) setJob((cur) => (cur?.jobId === next.job!.id ? cur : liveFromDetail(next.job!)))
        const latest = next.versions[next.versions.length - 1]?.n ?? null
        setSelected((cur) => (selectLatest || cur === null || !next.versions.some((v) => v.n === cur) ? latest : cur))
      } catch (e) {
        notify(userMessage(e), 'error')
        go({ name: 'home' })
      }
    },
    [slug, go, notify]
  )

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
        void load()
      }
      if (e.type === 'status' || e.type === 'reply' || e.type === 'tool') setJob((cur) => reduceLive(cur ?? EMPTY_LIVE, e))
      else if (e.type === 'render' && e.draft) {
        setJob((cur) => reduceLive(cur ?? EMPTY_LIVE, e))
        void load()
      } else if (e.type === 'done' || e.type === 'error' || e.type === 'cancelled') {
        setJob(null)
        setCompare(null)
        // an export ends with no new version
        void load(e.type === 'done' && e.version !== undefined)
      }
    })
    return () => {
      offAi()
      offQueue()
      offJobs()
    }
  }, [slug, load])

  useEffect(() => {
    if (!job?.jobId) {
      setSteps([])
      return
    }
    const m = job.message
    if (m === EMPTY_LIVE.message) return
    setSteps((s) => (s[s.length - 1] === m ? s : [...s, m]))
  }, [job?.jobId, job?.message])
  useEffect(() => {
    if (!job) setStopAsk(false)
  }, [job])

  const version = d ? (d.versions.find((v) => v.n === selected) ?? d.versions[d.versions.length - 1]) : undefined
  const changePreview = job?.preview?.video ?? null
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

  const exportFile = useCallback(async (): Promise<ExportResult> => {
    if (!version) throw { userMessage: 'Wait for your first version.' }
    const had = exports.current.get(version.n)
    if (had) return had
    const r = await reel.projects.exportVersion(slug, version.n)
    exports.current.set(version.n, r)
    return r
  }, [slug, version])

  const doExport = useCallback(
    async (toPhone = false) => {
      if (!version || job || exporting) return
      setPhoneFirst(toPhone)
      setExporting('busy')
      try {
        setExporting(await exportFile())
      } catch (e) {
        setExporting(null)
        notify(userMessage(e), 'error')
      }
    },
    [version, job, exporting, exportFile, notify]
  )

  useEffect(() => {
    const fn = () => { if (!platformPicker) void doExport() }
    window.addEventListener(EXPORT_EVENT, fn)
    return () => window.removeEventListener(EXPORT_EVENT, fn)
  }, [doExport, platformPicker])

  // N: ask about the moment on screen.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('.modal-backdrop, .drawer')) return
      if (!noteField.current || noteField.current.disabled) return
      e.preventDefault()
      setChip({ at: playhead.get() })
      noteField.current.focus()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [playhead])

  const entries = useMemo(
    () =>
      d
        ? notesLog({
            chat: d.chat,
            made: d.versionsMade,
            versions: d.versions,
            running: d.job ? { id: d.job.id, kind: d.job.kind === 'rerender' ? 'hand' : d.job.kind === 'first-edit' ? 'first-edit' : 'note' } : null,
            sourceName: d.project.sources?.[0]?.path ? fileName(d.project.sources[0].path) : null,
            now: new Date()
          })
        : [],
    [d]
  )
  const changes = useMemo(() => (d ? versionChanges(d.versions, d.versionsMade) : new Map<number, string>()), [d])
  const byHand = useMemo(() => new Set(d?.versionsMade.filter((m) => m.by === 'hand').map((m) => m.version) ?? []), [d])

  if (!d)
    return (
      <div className="page">
        <Spinner />
      </div>
    )

  const aiOff = providerChecked && (!provider || !provider.connected || provider.id === 'none')
  const connect = () => go({ name: 'connect', back: { name: 'reel', slug } })
  const making = job && latestN !== undefined && d.job?.kind !== 'export' ? latestN + 1 : null

  const note = async (text: string, files: string[] | undefined, moment: NoteMoment | undefined) => {
    const r = await reel.projects.note(slug, text, files, moment, version?.n)
    if (r.jobId) setJob((cur) => (cur?.jobId === r.jobId ? cur : { ...EMPTY_LIVE, jobId: r.jobId, message: 'Reading your note' }))
    await load()
  }

  /** The words on screen at `at` in the version shown, or why a note can't point there. */
  const momentAt = async (at: number): Promise<NoteMoment | string> => {
    const n = onScreen?.n ?? version?.n
    const tl = n !== undefined ? await reel.projects.timeline(slug, n).catch(() => null) : null
    if (!tl || n === undefined) return NO_TIMELINE
    if (at > tl.duration) return `There's no ${clock(at)} in this video. It's ${clock(tl.duration)} long.`
    const words = wordsAt(tl.words, at)
    return words.length ? noteMoment(at, n, words) : noWords(at)
  }

  const send = async () => {
    const text = draft.trim()
    const files = att.chips
    if ((!text && !files.length) || att.busy || !providerChecked) return
    setAlert(null)
    let moment: NoteMoment | undefined
    if (chip) {
      const m = await momentAt(chip.at)
      if (typeof m === 'string') return setAlert(m)
      moment = m
    }
    setDraft('')
    setChip(null)
    att.clear()
    try {
      await note(text || 'Put this here', files.length ? files.map((f) => f.asset) : undefined, moment)
    } catch (e) {
      setDraft(text)
      att.restore(files)
      setAlert(userMessage(e))
    }
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

  const rerender = async (change = '', message = 'Making a new version with your changes') => {
    try {
      const r = await reel.projects.rerender(slug, change, message)
      setJob((cur) => (cur?.jobId === r.jobId ? cur : { ...EMPTY_LIVE, jobId: r.jobId, message }))
      setDrawer(null)
      setPreview(null)
      await load()
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  const savePost = async (text: string): Promise<boolean> => {
    const caption = text.trim()
    if (caption === (d.project.post?.caption ?? '').trim()) return true
    try {
      await reel.projects.update(slug, { post: { hashtags: [], keywords: [], ...(d.project.post ?? {}), caption } })
      await load()
      return true
    } catch (e) {
      notify(userMessage(e), 'error')
      return false
    }
  }

  const marks = timeline && timeline.video === shownVideo ? noteMarks(d.chat, job?.jobId ?? null, timeline.words) : []
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
    else openDrawer(ACTION_TAB[a] ?? 'cut')
  }
  // "Edit it myself" changes the newest version: with an older one on screen, show the newest first.
  const openDrawer = (t: Tab) => {
    if (older && latestN !== undefined) setSelected(latestN)
    setCompare(null)
    setDrawer(t)
  }
  const watch = (n: number) => {
    setCompare(null)
    setSelected(n)
    setFreshPlay(false)
    if (!changePreview) setPlayRequest({ n, ask: ++playAsks.current })
  }

  // A note at a spot on the picture: about that moment, with where it is in words the editor reads.
  const pinNote = async (text: string, at: number, x: number, y: number): Promise<boolean> => {
    const m = await momentAt(at)
    const where = region(x, y)
    try {
      await note(`${text} (${where === 'the middle' ? 'in the middle' : `at the ${where}`} of the picture)`, undefined, typeof m === 'string' ? undefined : m)
    } catch (e) {
      notify(userMessage(e), 'error')
      return false
    }
    const next = [...pins, { n: (pins[pins.length - 1]?.n ?? 0) + 1, at, x, y, text }]
    localStorage.setItem(pinsKey(slug), JSON.stringify(next))
    setPins(next)
    return true
  }
  const unzoom = (at: number) => {
    setZoom(false)
    playhead.set(at)
    const phone = document.querySelector<HTMLVideoElement>('[data-testid="player"]')
    if (phone) phone.currentTime = at
  }

  const exportLabel = version && (older || compare) ? `Export Version ${version.n}` : 'Export for Instagram'
  const waiting = d.queue.filter((q) => !q.attempt).length
  const src = changePreview ?? version?.video ?? null

  const notesColumn = (where: 'main' | 'zoom') => (
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
        shown={onScreen?.n ?? null}
        making={making}
        busy={!!job}
        aiOn={!aiOff}
        noAiCut={!d.aiEdited}
        versionRows={versionRows}
        onPlay={watch}
        onAction={runAction}
        onRetry={(text, moment) => void note(text, undefined, moment ?? undefined).catch((e) => setAlert(userMessage(e)))}
        onError={(m) => notify(m, 'error')}
        answerError={answerError}
      />
      <div
        className="cwrap"
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          if (!Array.from(e.dataTransfer.types).includes('Files') || aiOff) return
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
        <StopAsk
          open={stopAsk && (where === 'zoom') === zoom}
          kept={latestN ?? 0}
          waiting={waiting}
          onStop={() => (setStopAsk(false), job?.jobId && void reel.jobs.cancel(job.jobId))}
          onKeep={() => setStopAsk(false)}
        />
        <Composer
          where={where}
          draft={draft}
          onDraft={setDraft}
          chip={chip}
          onChip={setChip}
          playhead={playhead}
          att={heldN ? { ...att, busy: att.busy + heldN } : att}
          aiOn={!aiOff}
          checking={!providerChecked}
          job={job}
          making={making}
          steps={steps}
          stepNote={job ? d.chat.find((m) => m.from === 'you' && m.jobId === job.jobId) : null}
          held={d.queueHeld ? waiting : 0}
          alert={alert}
          onSend={() => void send()}
          onStop={() => setStopAsk(true)}
          onRunNext={() => void reel.queue.runNext(slug).catch((e) => notify(userMessage(e), 'error'))}
          onClear={() => void reel.queue.clear(slug).catch((e) => notify(userMessage(e), 'error'))}
          onConnect={connect}
          inputRef={where === 'main' ? noteField : undefined}
        />
      </div>
    </>
  )

  return (
    <div className={`reel-page${fresh ? ' fresh' : ''}`}>
      <div className="reel-h">
        {renaming === null ? (
          <h1 className="reel-title" title="Click to rename" onClick={() => setRenaming(d.title)} data-testid="title">
            {d.title}
          </h1>
        ) : (
          <input
            className="input reel-title-input"
            autoFocus
            value={renaming}
            aria-label="Video name"
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
        {version && (
          <VersionPicker
            versions={d.versions}
            shown={version.n}
            changes={changes}
            byHand={byHand}
            rows={versionRows}
            onPick={watch}
            onCompare={(b, a) => {
              setCompare({ a, b })
              setSelected(b)
              setFreshPlay(false)
            }}
          />
        )}
        {older && !compare && (
          <button className="btn ghost small" onClick={() => watch(latestN!)} data-testid="version-latest">
            Back to latest
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => openDrawer('cut')} disabled={!version} data-testid="edit-myself">
          <Icon name="sliders" size={16} /> Edit it myself
        </button>
        <button
          ref={moreBtn}
          className="icon-btn"
          aria-label="More for this video"
          aria-haspopup="menu"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
          data-testid="more"
        >
          <Icon name="more" />
        </button>
        <PopMenu
          open={more}
          onClose={() => setMore(false)}
          anchor={moreBtn}
          label="More for this video"
          style={{ right: 28, top: 52, width: 230 }}
          origin="top right"
        >
          <button className="mi" role="menuitem" onClick={() => (setMore(false), setRenaming(d.title))} data-testid="rename">
            <Icon name="pencil" size={16} /> Rename
          </button>
          <button className="mi" role="menuitem" onClick={() => (setMore(false), void reel.app.openFolder(d.dir))}>
            <Icon name="folder" size={16} /> Show in {FOLDER_APP}
          </button>
          <hr />
          <button className="mi danger" role="menuitem" disabled={!!job} onClick={() => (setMore(false), setConfirmDelete(true))} data-testid="delete">
            <Icon name="trash" size={16} /> Delete this video…
          </button>
        </PopMenu>
      </div>

      <div className="reel-b">
        <div className="pcol">
          <PhonePlayer
            src={src}
            poster={version?.cover}
            autoPlayMuted={!!changePreview || (freshPlay && version?.n === latestN)}
            playRequest={!changePreview && playRequest?.n === version?.n ? playRequest?.ask : undefined}
            onPlayRequestHandled={() => setPlayRequest(null)}
            subtitle={drawer === 'captions' && preview ? preview : null}
            still={drawer === 'captions' && preview && d.sourceVideo ? `${d.sourceVideo}#t=${preview.at.toFixed(2)}` : null}
            stillMirrored={d.project.sources?.[0]?.mirror === true}
            view={phoneView}
            caption={d.project.post?.caption}
            original={d.sourceVideo}
            originalAt={originalAt}
            originalReady={originalReady}
            warmOriginal={warmOriginal}
            holdingOriginal={holding}
            dragFile={version && !version.draft ? version.videoPath : null}
            marks={marks}
            playhead={playhead}
            onShown={setShownSrc}
            keepTime={!!compare}
            onZoom={version ? () => setZoom(true) : undefined}
            onFailed={() => {
              notify('I could not find that video. It may have been moved or deleted.', 'error')
              if (onScreen) setSelected(onScreen.n)
            }}
            over={
              compare && (
                <div className="abswitch" role="group" aria-label="Compare versions" data-testid="compare">
                  {[compare.a, compare.b].map((n) => (
                    <button
                      key={n}
                      className={selected === n ? 'on' : undefined}
                      aria-pressed={selected === n}
                      onClick={() => setSelected(n)}
                      data-testid={`compare-pick-${n}`}
                    >
                      Version {n}
                    </button>
                  ))}
                </div>
              )
            }
          />
          {changePreview && (
            <p className="muted-sm center" data-testid="change-preview">
              Here's your change. I'm making the full-quality version.
            </p>
          )}
          <div className="under">
            {compare ? (
              <button className="btn ghost small" onClick={() => setCompare(null)} data-testid="done-compare">
                <Icon name="x" size={14} /> Done comparing
              </button>
            ) : (
              <>
                <PhoneViewSwitch value={phoneView} onChange={(v) => void setPhoneView(v).catch((e) => notify(userMessage(e), 'error'))} />
                {d.sourceVideo && (
                  <button
                    className={`btn ghost small${holding ? ' on' : ''}`}
                    onPointerEnter={() => setWarmOriginal(true)}
                    onFocus={() => setWarmOriginal(true)}
                    onPointerDown={() => setHolding(true)}
                    onPointerUp={() => setHolding(false)}
                    onPointerLeave={() => setHolding(false)}
                    onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setHolding(true)}
                    onKeyUp={() => setHolding(false)}
                    aria-label="Hold for original"
                    data-tip="Hold to see your video before I edited it"
                    data-testid="hold-original"
                  >
                    <Icon name="original" size={14} /> <span className="lbl">Original</span>
                  </button>
                )}
                <button className="btn ghost small" onClick={() => setZoom(true)} disabled={!version} aria-label="Zoom in" data-tip="Zoom in" data-testid="zoom-in">
                  <Icon name="zoom-in" size={14} /> <span className="lbl">Zoom in</span>
                </button>
              </>
            )}
          </div>
          <Outs
            label={exportLabel}
            disabled={!version || !!job}
            why={job ? 'Wait for this version to finish' : undefined}
            onExport={() => void doExport()}
            onPhone={() => void doExport(true)}
            onPlatforms={() => setPlatformPicker(true)}
            exportFile={exportFile}
          />
        </div>

        <div className="rdiv" />

        <div className="ncol">{notesColumn('main')} </div>
      </div>

      {zoom && version && (
        <ZoomView
          title={d.title}
          picker={
            <VersionPicker
              versions={d.versions}
              shown={version.n}
              changes={changes}
              byHand={byHand}
              rows={versionRows}
              onPick={watch}
              onCompare={(b, a) => setCompare({ a, b })}
              testid="zoom-version-switch"
            />
          }
          src={src}
          compare={
            compare
              ? {
                  a: { n: compare.a, src: d.versions.find((v) => v.n === compare.a)!.video },
                  b: { n: compare.b, src: d.versions.find((v) => v.n === compare.b)!.video }
                }
              : null
          }
          playhead={playhead}
          original={d.sourceVideo}
          pins={pins}
          notes={notesColumn('zoom')}
          exportLabel={exportLabel}
          disabled={!version || !!job}
          aiOn={!aiOff}
          onClose={unzoom}
          onExport={() => void doExport()}
          onPhone={() => void doExport(true)}
          onDoneCompare={() => setCompare(null)}
          onPin={pinNote}
        />
      )}

      {drawer && (
        <ShowMeHow
          d={d}
          initialTab={drawer}
          version={version ?? null}
          onClose={() => {
            setDrawer(null)
            setPreview(null)
          }}
          onChanged={() => load()}
          onRerender={(change, label) => void rerender(change, label ?? (drawer ? CHANGE_LABEL[drawer] : undefined))}
          onPreview={setPreview}
          onTab={(t) => setDrawer(t)}
        />
      )}

      {confirmDelete && (
        <Confirm
          title="Delete this video?"
          body="This removes all its versions from Reel Studio. Anything you exported stays in Finished videos."
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

      {platformPicker && version && <PlatformExportDialog slug={slug} version={version} post={d.project.post} jobId={job?.jobId || undefined} status={job?.message} onClose={() => setPlatformPicker(false)} />}
      {exporting && <ExportDialog result={exporting} phoneFirst={phoneFirst} onClose={() => setExporting(null)} onSaveCaption={(t) => savePost(t)} />}
    </div>
  )
}

/** "Stop and keep Version 3?" above the note box: the safe choice has focus. */
function StopAsk({ open, kept, waiting, onStop, onKeep }: { open: boolean; kept: number; waiting: number; onStop: () => void; onKeep: () => void }) {
  const { mounted, leaving } = usePresence(open, 120)
  const keep = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    keep.current?.focus()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onKeep()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onKeep])
  if (!mounted) return null
  return (
    <div
      className={`pop confirm${leaving ? ' leave' : ''}`}
      role="alertdialog"
      aria-label="Stop"
      style={{ right: 8, bottom: 'calc(100% + 8px)', ['--o' as string]: 'bottom right' }}
      data-testid="stop-confirm"
    >
      <h3>{kept ? `Stop and keep Version ${kept}?` : 'Stop this change?'}</h3>
      <p>
        Your note stays here, so you can send it again.
        {waiting > 0 && ' The notes after it wait until you send them.'}
      </p>
      <div className="row">
        <button className="btn ghost small" onClick={onStop} data-testid="stop-yes">
          Stop
        </button>
        <button ref={keep} className="btn small" onClick={onKeep} data-testid="stop-no">
          Keep going
        </button>
      </div>
    </div>
  )
}

/**
 * After Export: the file is on the computer, Instagram is on the phone. Everything needed to post
 * is in this one box: where the file is, the post caption (edit and copy it here), and how to get
 * the video to Instagram. Never "go back and export again" for text that is not in the video.
 */
function ExportDialog({
  result,
  phoneFirst,
  onClose,
  onSaveCaption
}: {
  result: 'busy' | ExportResult
  phoneFirst?: boolean
  onClose: () => void
  onSaveCaption: (t: string) => Promise<boolean>
}) {
  const [opened, setOpened] = useState(false)
  const [phone, setPhone] = useState(!!phoneFirst)
  const [caption, setCaption] = useState(result === 'busy' ? '' : result.caption)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (result !== 'busy') setCaption(result.caption)
  }, [result])

  if (result === 'busy')
    return (
      <Modal testid="export-dialog">
        <h2>Getting it ready for Instagram</h2>
        <div className="row">
          <Spinner /> <span className="muted">This takes a moment.</span>
        </div>
      </Modal>
    )

  // "Send to my phone" (components/SendToPhone.tsx): a QR code that opens this video on the phone.
  if (phone)
    return (
      <Modal onClose={onClose} wide testid="export-dialog">
        <SendToPhone video={result.video} caption={caption} onBack={() => setPhone(false)} />
      </Modal>
    )

  return (
    <Modal onClose={onClose} wide testid="export-dialog">
      <div className="export-head">
        {result.cover && <img className="cover-img" style={{ width: 84 }} src={`reel-media://f/${encodeURIComponent(result.cover)}`} alt="" />}
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          {/* says plainly that it is saved, and where (grandma3 #8, #17) */}
          <h2 data-testid="export-saved">Saved to your computer</h2>
          <p className="muted-sm">Ready to post. Find it any time in Library › Finished videos:</p>
          <p className="file-pill" data-testid="export-name" title={result.video}>
            <Icon name="video" size={16} /> {fileName(result.video)}
          </p>
          <div className="row">
            <button
              className="btn small"
              onClick={async () => {
                await reel.app.openFolder(result.video)
                setOpened(true)
              }}
              data-testid="show-in-folder"
            >
              <Icon name="folder" size={16} /> Show in {FOLDER_APP}
            </button>
          </div>
          {opened && (
            <p className="muted-sm" data-testid="opened">
              I opened {FOLDER_APP} with your video selected.
            </p>
          )}
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <label className="field-label" htmlFor="export-caption">
          Post caption <span className="muted-sm">(you paste this into Instagram)</span>
        </label>
        <textarea
          id="export-caption"
          className="textarea"
          style={{ minHeight: 84 }}
          value={caption}
          placeholder="Write a line or two about your video. You can also leave it empty."
          onChange={(e) => {
            setCaption(e.target.value)
            setCopied(false)
          }}
          onBlur={() => void onSaveCaption(caption)}
          data-testid="export-caption"
        />
        <div className="row">
          <button
            className="btn small"
            disabled={!caption.trim()}
            data-testid="copy-caption"
            onClick={async () => {
              await reel.app.copyText(caption)
              void onSaveCaption(caption)
              setCopied(true) // the button says "Copied"; no toast on top of the dialog
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy caption'}
          </button>
        </div>
      </div>

      <div className="post-how">
        <p>Instagram is on your phone? Send the video there in one step. Or upload it at instagram.com.</p>
        <div className="stack" style={{ gap: 8 }}>
          <button className="btn primary big" onClick={() => setPhone(true)} data-testid="send-to-phone">
            <Icon name="send" size={16} /> Send to my phone
          </button>
          <CloudSave video={result.video} />
          <a className="btn small" href={INSTAGRAM_URL} target="_blank" rel="noreferrer" data-testid="open-instagram">
            <Icon name="instagram" size={16} /> Open Instagram
          </a>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn ghost" onClick={onClose} data-autofocus>
          Done
        </button>
      </div>
    </Modal>
  )
}
