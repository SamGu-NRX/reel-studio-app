// Types shared by the main process, the preload bridge and the renderer.
// Keep this file free of Node and DOM imports.
import type { ChatAction } from './notes'
import type { UpdateActionResult, UpdateBusy, UpdateState } from './update'
import type { CoverCandidate } from './cover'
import type { RenderSegment } from './moments'
import type { VersionRow } from './version-diff'
import type { Step } from './steps'
import type { HandEdit } from './hand-edit'
import type { SoundEffect } from './sfx'
export type { VersionRow } from './version-diff'
import type { Platform, PlatformExportRequest } from './platforms'
export type { ChatAction } from './notes'
export type { CoverCandidate } from './cover'

export type AppCommand = { type: 'new-video' | 'settings' | 'export' | 'library' } | { type: 'open-reel'; slug: string }

/** planned: a reel with no video yet (New reel); its notes column is for planning and scripts. */
export type ScreenStatus = 'planned' | 'new' | 'working' | 'ready' | 'interrupted' | 'failed'

export interface ProjectSummary {
  slug: string
  dir: string
  title: string
  createdAt: string
  updatedAt: string
  version: number
  thumbnail: string | null
  status: ScreenStatus
  /** Notes waiting their turn (not counting one that is running). */
  waiting: number
  /** A planned reel: no video brought in yet, nothing made, nothing running. */
  noVideo: boolean
  /** Before Version 1 has a cover: the video it is made from (reel-media URL), for a frame of it. Null once there's a cover or no video. */
  take: string | null
  /** When the newest version was made (ISO), or null before Version 1. */
  versionAt: string | null
  /** project.json `series`: the group it belongs to on Reels, or null. */
  series: string | null
  /** Paused without you (app.json `paused`): it continues on its own, and this says when or what for. Null when it
   * runs, or waits for you. */
  pausedFor: PausedFor | null
  /** Why Version 1 didn't finish (app.json `lastError`), for its card. Null unless `status` is 'failed'. */
  failedWhy: string | null
  /** A version of it was posted (app.json `posted`). */
  posted: boolean
}

export interface VersionInfo {
  n: number
  video: string
  videoPath: string
  draft: boolean
  cover: string | null
  createdAt: string
}

export interface Word {
  id: string
  w: string
  s: number
  e: number
  source?: string
}

/** A caption word as the engine drew it, the transcript words it came from, and its speech run (lines in
 * different runs have a long silence between them). */
export interface CaptionToken {
  w: string
  ids: string[]
  run: number
}

export interface ChecklistItem {
  key: string
  label: string
  done: boolean
  detail?: string
}

/**
 * What made a version, recorded in app.json once, when its final render first succeeded
 * (main/jobs.ts). A rerender that reuses the version records nothing.
 */
export interface VersionMade {
  version: number
  by: 'note' | 'hand'
  /** The note as the person wrote it (may be empty when only files were attached), or the change made by hand. */
  summary: string
  at: string
}

export interface ChatMessage {
  id: string
  from: 'you' | 'editor'
  text: string
  at: string
  version?: number
  /** Buttons under an editor message (e.g. "Open caption settings", "Connect ChatGPT"). */
  actions?: ChatAction[]
  /** A My style rule the AI suggested; saved only if the user answers Yes (remember-yes). */
  suggestion?: string
  /** A typed My style rule to ask about instead (lowercase captions after a note made them so). */
  proposal?: StyleProposal
  /** Pictures, GIFs or clips the user attached to this note (a "you" message). */
  attachments?: NoteAttachment[]
  /** Where a note asked "Just here" points: shown as a muted "0:08" before the words and placed as a mark (shared/moments.ts). */
  moment?: NoteMoment
  /** The job this note started, and how that job ended (the marks on the scrub bar, shared/moments.ts). */
  jobId?: string
  outcome?: NoteOutcome
  /** Said while planning, before the reel had a video. */
  plan?: true
  /** The script the editor wrote for a planned reel (an editor message). */
  script?: ScriptResult
}

/** done: the note made a new version. failed: an error, or nothing changed. stopped: Stop, or the app quit. */
export type NoteOutcome = 'done' | 'failed' | 'stopped' | 'paused'

/** What stopped work the person didn't stop (ux-foundation-b.md section 3.4): a plan at its limit, no internet, the
 * computer asleep, or a quit. */
export type PauseReason = 'limit' | 'offline' | 'sleep' | 'quit'
export interface PausedFor {
  reason: PauseReason
  /** when it continues (ISO), when that is known (a plan's reset time) */
  until: string | null
  /** the editor whose plan it is ("Claude"), for the words; null when not known */
  editor: string | null
}

/** A note's moment: the time in the version watched, and the words on screen then. */
export interface NoteMoment {
  /** seconds into `version` (0 = the Preview) */
  at: number
  /** the end of a range dragged on the timeline; absent for one moment */
  to?: number
  version: number
  /** transcript word ids, in the order they play */
  words: string[]
  /** those words as said, for people */
  quote: string
}

/** A word on screen at a moment of a render. */
export interface MomentWord {
  id: string
  w: string
}

/** A word where a render plays it: `s`/`e` in seconds on that render's output clock (projects.timeline). */
export interface PlacedWord extends MomentWord {
  s: number
  e: number
}

/** A file attached to a note: what `engine attach` wrote in its sidecar (shared/attachments.ts). */
export interface NoteAttachment {
  /** project-relative `work/assets/attach-*` */
  asset: string
  /** the original file name, for the user */
  name: string
  kind: 'image' | 'video'
  bytes: number
  width?: number
  height?: number
  duration?: number
  hasAudio?: boolean
  /** an animated GIF, turned into a silent clip */
  fromGif?: boolean
  /** project-relative 320 px still */
  thumb?: string
  /** reel-media URL of the still (filled by main when it goes to the page) */
  thumbUrl?: string
}

/** A note the creator sent. It runs, in order, on whatever version is newest when its turn comes;
 * `seenVersion` is the version that was on screen when it was written. `id` is what project.json.notes
 * saves it under. */
export interface QueuedNote {
  id: string
  text: string
  attachments: NoteAttachment[]
  seenVersion: number
  /** a "Just here" note's place (shared/moments.ts) */
  moment?: NoteMoment
  /** Set while its note job runs: `base` = the version it started from. */
  attempt?: { base: number }
  /** A change made in "Edit it myself" rather than a note: it runs without the editor (`text` says what it changes). */
  hand?: { edit: HandEdit; changes: number }
}

/** What came of attaching: the files that made it, and a plain message for each one that did not. */
export interface AttachResult {
  attached: NoteAttachment[]
  errors: string[]
}

export interface ProjectDetail extends ProjectSummary {
  /** The raw take (reel-media URL), or null before it is copied in. */
  sourceVideo: string | null
  /** Every raw take by source id (reel-media URL), for the ones on disk. */
  sourceVideos: Record<string, string>
  project: ProjectJson
  versions: VersionInfo[]
  words: Word[]
  keptIds: string[]
  /** The caption lines of the last full render, word by word (engine work/captions.json). */
  captionLines: CaptionToken[][]
  checklist: ChecklistItem[]
  versionsMade: VersionMade[]
  chat: ChatMessage[]
  lastError: { code: string; userMessage: string } | null
  /** Notes waiting their turn, in the order they will run. */
  queue: QueuedNote[]
  /** True: the queue waits for "Run next" (after Stop, a failed note, or a restart). */
  queueHeld: boolean
  job: { id: string; kind: JobKind; message: string; pct: number; overall: number; secondsLeft: number | null; overdue: boolean; thinking: boolean; waiting: boolean; steps?: Step[] } | null
  /** A small picture for each b-roll item with an image file (broll id -> reel-media URL). Animations and
   * text-only items have none (the Pictures list names them in words instead of a file name). */
  brollThumbs: Record<string, string>
  /** Who to credit for each b-roll picture (broll id -> one line), for those that have a credit. */
  brollCredits: Record<string, string>
  /** True when an AI editor made this video's edit. False = the simple no-AI edit (be honest about it). */
  aiEdited: boolean
}

// Loose mirror of project.json (docs/architecture.md section 3). The engine owns validation.
export interface ProjectJson {
  schemaVersion: number
  id: string
  title: string
  slug: string
  createdAt: string
  updatedAt: string
  version: number
  format?: { width: number; height: number; fps: number }
  /** `mirror`: the take is mirrored, the engine flips the picture (absent = as filmed) */
  sources?: { id: string; path: string; originalName?: string; duration?: number; rotation?: number; mirror?: boolean }[]
  /** The group this reel belongs to on Reels ("Sourdough basics"). */
  series?: string
  transcript?: { file: string; language?: string }
  cut?: { keep: { from: string; to: string }[]; gapCap?: number; minSaving?: number }
  captions?: {
    enabled: boolean
    style?: Record<string, unknown>
    /** `at` (through `through`): fixes only that word, made of those words, while it is heard as `from` (the Subtitles list). */
    corrections?: { from: string; to: string; at?: string; through?: string }[]
    /** word ids that start a caption line; lines starting at `to` that go onto the line ending at `from` */
    split?: string[]
    join?: { from: string; to: string }[]
  }
  music?: {
    enabled: boolean
    track: string | null
    startAt?: number
    level?: string
    automation?: unknown[]
    fadeOut?: number
  }
  broll?: {
    id: string
    anchor: { from: string; to: string }
    treatment: string
    /** Library path, project path or animation id; null for text-only treatments. */
    asset: string | null
    params?: Record<string, unknown>
  }[]
  zooms?: unknown[]
  /** Built-in sound effects (docs/schema-changes.md, 2026-10-22): `sound` is a pack id, `at` one moment. */
  sfx?: { at: { word?: string; broll?: string; cut?: string }; sound: string; gainDb?: number }[]
  /** manual: the person picked this exact frame in the app (rendered as is). exact: the AI looked at this frame
   * (the engine searches 0.2 s around it). Neither: the engine searches 1.5 s around atSourceTime. */
  cover?: { atSourceTime: number; source: string; text: string | null; exact?: boolean | null; manual?: boolean | null }
  post?: { caption: string; hashtags: string[]; keywords: string[] }
  notes?: { version: number; text: string; applied: string[]; at: string }[]
  [k: string]: unknown
}

export type JobKind = 'first-edit' | 'note' | 'rerender' | 'export' | 'script'

/** The steps of a job, tagged by the ai package on its status events (main/progress.ts times them). */
export type Phase = 'listen' | 'analyze' | 'firstLook' | 'edit' | 'final'

/**
 * What a running job reports to main (jobs.ts `Emit`): the ai package's AgentEvent plus what main adds
 * itself. ONE contract; `shared/live.ts` is the only reader on the renderer side.
 */
export type JobUpdate =
  /** pct restarts per step unless aggregate marks whole-job progress. thinking = waiting on AI. */
  | { type: 'status'; message: string; pct?: number; aggregate?: true; phase?: Phase; thinking?: boolean; /** the message is the wait for the editor itself (ai agent.ts waitWords) */ waiting?: boolean; noAI?: boolean }
  | { type: 'tool'; name: string; summary: string }
  /** A line for main.log only: how a model turn spent its time (ai agent.ts turnTrace). */
  | { type: 'trace'; text: string }
  /** A render finished. firstLook = the quick no-AI preview made while the AI still edits (not a version).
   * file = the engine's output path (absolute); main turns it into `video` for the renderer. */
  | { type: 'render'; version: number; draft: boolean; firstLook?: boolean; file?: string }
  /** The reply to a note, known before the render that makes it true (fast notes). Shown at once;
   * the same text lands in the chat when the job is done. */
  | { type: 'reply'; text: string }
  /** The words heard, once listening is done (main reads them from the transcript). */
  | { type: 'heard'; words: string[] }

type Ids = { jobId: string; slug: string | null }

/** Every event the renderer receives (`reel.jobs.onEvent`). */
export type JobEvent = Ids &
  (
    /** overall = honest 0-99 for the whole job, never backwards; secondsLeft = from this computer's measured
     * history (main/progress.ts), null = too early to say. Status repeats about once a second while a job
     * runs (thinking kept), so a bar fed by `overall` never freezes. */
    /** overdue = the current phase outlasted its usable estimate: show "Still working, almost there", no number. */
    /** steps: a first edit's rows (shared/steps.ts) */
    | { type: 'status'; message: string; pct: number; phase?: Phase; overall: number; secondsLeft: number | null; overdue: boolean; thinking: boolean; waiting: boolean; steps?: Step[] }
    | { type: 'tool'; name: string; summary: string }
    /** video = a playable reel-media URL of a stable copy (never the file the engine overwrites next). */
    | { type: 'render'; version: number; draft: boolean; firstLook: boolean; video: string | null }
    | { type: 'reply'; text: string }
    | { type: 'heard'; words: string[] }
    | { type: 'done'; summary: string; version?: number }
    | { type: 'error'; code: string; userMessage: string }
    | { type: 'cancelled' }
    /** Stopped by something outside the person (main/pause.ts); it continues on its own. */
    | { type: 'paused'; paused: PausedFor }
  )

export interface LibraryFile {
  name: string
  path: string
  url: string
  size: number
  modifiedAt: string
  /** "CC BY 4.0 · Jane Doe": from the folder's credits.json, or the sound pack. None: the person's own file. */
  licence?: string
  /** Known without reading the file (the sound pack). */
  durationSec?: number
  /** The sound pack's job for a sound effect: whoosh, pop, click... */
  group?: string
}

export interface LibraryBin {
  /** sfx: the sound effects that come with Reel Studio, not a folder of yours. */
  key: 'raw' | 'broll' | 'music' | 'images' | 'sfx'
  label: string
  dir: string
  files: LibraryFile[]
}

/** A Library file's preview, made once and kept: a strip of frames for a clip, the loudness shape for a song. */
export interface LibraryPreview {
  durationSec: number
  /** reel-media URL of a strip of four frames (clips). */
  sheet?: string
  /** 0..1 peaks, evenly spaced over the file (audio). */
  peaks?: number[]
}

export interface DropResult {
  file: string
  name: string
  bin: 'raw' | 'broll' | 'music' | 'images' | 'exports' | null
  dest: string | null
  reason?: string
}

export interface ProviderInfo {
  id: 'chatgpt' | 'claude' | 'codex-cli' | 'claude-cli' | 'custom' | 'replay' | 'none'
  connected: boolean
  label: string
  detail?: string
  error?: UserError
  connectionId?: string
}

export type ConnectionKind = 'anthropic' | 'openai'

/** The key never comes back to the page, only `hasKey`. */
export interface ConnectionInfo {
  id: string
  label: string
  kind: ConnectionKind
  baseURL: string
  model: string
  /** false: the AI editor is never sent pictures through this server */
  supportsImages: boolean
  hasKey: boolean
  active: boolean
}

export interface ConnectionInput {
  id?: string
  label: string
  kind: ConnectionKind
  baseURL: string
  model: string
  /** empty keeps the stored key when editing */
  key?: string
}

export interface SaveConnectionResult {
  status: ProviderInfo
  connection?: ConnectionInfo
  error?: UserError & { field?: 'label' | 'address' | 'key' | 'model' }
}

export interface AppInfo {
  version: string
  platform: string
  root: string
  /** The root in friendly words: "Documents › Reel Studio". */
  rootDisplay: string
  firstRunDone: boolean
  fasterExports: boolean
  engine: { mode: 'real' | 'fake'; dir: string; python: string }
  ai: 'package' | 'mock'
  test: boolean
  /** REELSTUDIO_DEV=1: show the dev-only AI providers. */
  dev: boolean
  /** The computer account's name, for the sidebar. null in tests or when it cannot be read. */
  userName: string | null
  /** Settings › Your AI editor › Models: 'auto' or a model the person picked, per role. */
  models: ModelChoice
  /** Settings › Privacy. Nothing is sent anywhere: there is no place to send it yet. */
  sharing: DataSharing
  /** How the phone preview shows a reel: under Instagram's Reels screen, or the video alone. */
  phoneView: PhoneView
  /** Whether the first run's sample plays its sound effects. */
  soundEffects: boolean
}

export type PhoneView = 'instagram' | 'clean'

export type ModelRole = 'editor' | 'checker' | 'writer'
export type ModelChoice = Record<ModelRole, string>

/** Anonymous data sharing. `asked`: the first run asked once; until then nothing is on. */
export interface DataSharing {
  asked: boolean
  on: boolean
  usage: boolean
  quality: boolean
  posts: boolean
}

/** The person's own Claude Code app: not found / found but will not start / not signed in / ready. */
export type ClaudeCodeState = 'missing' | 'broken' | 'signed_out' | 'ready'

/** What the page learns about it. Never the account (no e-mail, no organization), never a path. */
export interface ClaudeCodeInfo {
  state: ClaudeCodeState
  version?: string
  /** the plan kind, e.g. "pro" or "max" */
  plan?: string
  /** plain words when it is not ready */
  reason?: string
}

export interface ModelStatus {
  name: string
  installed: boolean
  downloading: boolean
  /** Checking a copy found on this computer before using it */
  checking: boolean
  reused: boolean
  checkFailed: boolean
  pct: number
  /** 0 when the size is not known */
  bytes: number
  total: number
  error: string | null
}

export interface StyleRule {
  id: string
  text: string
  createdAt: string
  /** Set: the app applies this rule itself when a new video is made. Otherwise the AI reads it on every edit. */
  payload?: { kind: 'caption-case'; case: 'lower' }
  paused?: boolean
  /** The reel, version and note it was learned from. */
  source?: { project: string; title: string; version: number; note?: string }
  /** Learned from another editor's export (My style, Learn from my past edits): its file name. */
  imported?: { file: string }
  consent?: { proposal: string; at: string }
}

/** One rule "Learn from my past edits" read from an export, with what it was read from. Nothing is saved until the person keeps it. */
export interface LearnedRule {
  text: string
  evidence: string
}

/** What "Learn from my past edits" read: the exports, how much was in them, and the rules, before any is saved. */
export interface StyleLesson {
  files: { path: string; name: string; editor: 'Final Cut Pro' | 'Premiere Pro' }[]
  timelines: number
  shots: number
  rules: LearnedRule[]
  /** Exports that couldn't be read, with the reason in plain words. */
  skipped: { name: string; reason: string }[]
}

export interface StyleProposal {
  id: string
  text: string
  payload: { kind: 'caption-case'; case: 'lower' }
  source: { project: string; title: string; version: number }
}

export interface ExportResult {
  folder: string
  video: string
  cover: string | null
  captionFile: string
  caption: string
}

export interface PlatformExportResult {
  folder: string
  /** `try` is set only when two versions were exported. A Try 2 on Try 1's video shares Try 1's `video` file. */
  files: { platform: Platform; try?: 1 | 2; video: string; cover: string; captionFile: string; caption: string }[]
}

/** "Send to my phone": one network the phone could reach this computer on. */
export interface PhoneAddress {
  address: string
  label: string
  likely: boolean
}

/** A running "Send to my phone" link (one video, one-time token, stops by itself). */
export interface PhoneShare {
  url: string
  address: string
  /** Every network the link could use, best first, for "Use a different network". */
  addresses: PhoneAddress[]
  expiresAt: number
  /** Bytes, for the email size warning. */
  size: number
  /** Show the "phone can't connect?" help after this long without a visit. */
  waitMs: number
}

export type PhoneEvent = { kind: 'page' } | { kind: 'video' } | { kind: 'stopped'; reason: 'timeout' | 'closed' }

export interface ScriptResult {
  hook: string
  script: string
  onScreenText: string[]
  /** A short title for the reel, when the editor gave one. */
  title?: string
}

export interface UserError {
  code: string
  userMessage: string
  /** A page that helps (e.g. the ChatGPT usage page). */
  link?: string
}

export interface CloudDrive {
  folder: string
  label: 'iCloud Drive' | 'Google Drive'
}

export interface ReelApi {
  app: {
    info(): Promise<AppInfo>
    clipboardFiles(): Promise<string[]>
    takeOpenFiles(): Promise<string[]>
    onFilesAvailable(cb: () => void): () => void
    finishFirstRun(): Promise<void>
    openFolder(path: string): Promise<void>
    copyText(text: string): Promise<void>
    pathForFile(file: File): string
    chooseFolder(): Promise<string | null>
    setRoot(path: string): Promise<AppInfo>
    setFasterExports(on: boolean): Promise<AppInfo>
    setModels(models: ModelChoice): Promise<AppInfo>
    setSharing(sharing: DataSharing): Promise<AppInfo>
    setPhoneView(view: PhoneView): Promise<AppInfo>
    setSoundEffects(on: boolean): Promise<AppInfo>
    /** Menu items, keyboard shortcuts handled by the menu, and notification clicks. */
    onCommand(cb: (c: AppCommand) => void): () => void
    /** Drag a finished file out of the app (desktop, folder, browser upload box). Call from dragstart. */
    startDrag(file: string): void
  }
  model: {
    status(): Promise<ModelStatus>
    download(): Promise<ModelStatus>
    /** Never downloads. */
    find(): Promise<ModelStatus>
    cancel(): Promise<void>
    onProgress(cb: (s: ModelStatus) => void): () => void
  }
  ai: {
    providers(): Promise<ProviderInfo[]>
    active(): Promise<ProviderInfo>
    setActive(id: ProviderInfo['id'], connectionId?: string): Promise<void>
    signInChatGPT(): Promise<ProviderInfo>
    cancelSignIn(): Promise<void>
    /** Cancel on "Checking Claude…": the check stops and nothing is connected. */
    cancelCheck(): Promise<void>
    signOutChatGPT(): Promise<void>
    setClaudeKey(key: string | null): Promise<ProviderInfo>
    /** A fresh look at the person's own Claude Code app. */
    claudeCodeStatus(): Promise<ClaudeCodeInfo>
    /** Opens a terminal window where the person signs in to their Claude Code app themselves. */
    openClaudeSignIn(): Promise<void>
    connections(): Promise<ConnectionInfo[]>
    saveConnection(input: ConnectionInput): Promise<SaveConnectionResult>
    removeConnection(id: string): Promise<void>
    setConnectionImages(id: string, supportsImages: boolean): Promise<void>
    /** `suggested` is null when no listed model is one Reel Studio knows: the person picks. */
    connectionModels(q: { kind: ConnectionKind; baseURL: string; key?: string; id?: string }): Promise<{ models: string[]; suggested: string | null; needsKey: boolean }>
    /** Returns unsubscribe. */
    onChange(cb: (p: ProviderInfo) => void): () => void
  }
  projects: {
    list(): Promise<ProjectSummary[]>
    /** Slugs of the reels whose title or spoken words contain every word of `query`, newest first. */
    search(query: string): Promise<string[]>
    get(slug: string): Promise<ProjectDetail>
    create(files: string[]): Promise<{ slug: string; jobId: string; skipped: DropResult[] }>
    /** New reel: a reel with no video yet, titled "New reel" until the editor titles it. */
    plan(): Promise<{ slug: string }>
    /** Leaving a reel: a New reel nobody touched is removed. */
    leave(slug: string): Promise<void>
    /** The video for a planned reel: its first edit starts, and the editor gets the reel's script. */
    addVideo(slug: string, files: string[]): Promise<{ jobId: string; skipped: DropResult[] }>
    /** The editor writes a script for a planned reel from `idea` (a job: its status line, Stop, the script in the chat). */
    script(slug: string, idea: string): Promise<{ jobId: string }>
    /** `basic`: make the version without the editor (a failed Version 1's "Make a basic version"). */
    resume(slug: string, basic?: boolean): Promise<{ jobId: string }>
    /** jobId null = no AI connected: the note and a plain reply were added to the chat, nothing runs.
     * `attachments`: `work/assets/attach-*` refs from notes.attach* (main re-checks each one).
     * `moment`: a "Just here" note's place; main writes it into the text the AI reads.
     * `onVersion`: the version on screen while it was written (default: the moment's). queued = it waits its turn. */
    note(slug: string, text: string, attachments?: string[], moment?: NoteMoment, onVersion?: number): Promise<{ jobId: string | null; queued?: boolean }>
    /** Every word version `n` (0 = the Preview) plays, on its own output clock, and its length. Read
     * fresh from that render's manifest each call, with the segments it was cut from. null when the render
     * left no timeline to read. */
    timeline(slug: string, n: number): Promise<{ duration: number; words: PlacedWord[]; segments: RenderSegment[] } | null>
    /** What version `n` changed, as before → after rows. null when its saved copy is gone. */
    versionRows(slug: string, n: number): Promise<VersionRow[] | null>
    update(slug: string, patch: Partial<ProjectJson>): Promise<ProjectDetail>
    /** A change from "Edit it myself": it waits its turn behind running and waiting notes, then lands on the
     * newest version (render only, never the editor). `summary`: what it changes, in plain words. `replace`: a
     * waiting hand edit's id, changed in place. queued = it waits its turn. */
    handEdit(slug: string, edit: HandEdit, summary: string, changes: number, replace?: string): Promise<{ jobId: string | null; queued?: boolean }>
    exportVersion(slug: string, version: number): Promise<ExportResult>
    /** The best cover frame near each raw-take moment, best first (engine cover-candidates). One look per
     * project at a time: asking again while one runs gets that one's answer. */
    coverCandidates(slug: string, moments: number[], source: string): Promise<CoverCandidate[]>
    /** Stops the look, if one runs; resolves once the engine has exited. */
    stopCoverCandidates(slug: string): Promise<void>
    exportPlatforms(slug: string, version: number, request: PlatformExportRequest): Promise<PlatformExportResult>
    remove(slug: string): Promise<void>
  }
  /** Pictures, GIFs and short clips on a note (0.1.2). Each call copies the files into the project. */
  notes: {
    attachFiles(slug: string, paths: string[]): Promise<AttachResult>
    /** a pasted or dropped file with no path on disk (a screenshot, a picture copied from a browser) */
    attachData(slug: string, file: { name: string; mime: string; bytes: Uint8Array }): Promise<AttachResult>
    /** the picture on the system clipboard (a paste that had an image but no file the page could read) */
    attachClipboard(slug: string): Promise<AttachResult>
    /** the file picker; an empty result = cancelled */
    choose(slug: string): Promise<AttachResult>
    /** removes an attached file that is not in the video */
    remove(slug: string, asset: string): Promise<void>
  }
  jobs: {
    cancel(jobId: string): Promise<void>
    onEvent(cb: (e: JobEvent) => void): () => void
  }
  /** Notes waiting their turn on one reel (main/note-queue.ts). Only a note still waiting can change. */
  queue: {
    edit(slug: string, id: string, text: string): Promise<void>
    cancel(slug: string, id: string): Promise<void>
    /** -1 = one place earlier, 1 = one place later */
    move(slug: string, id: string, by: -1 | 1): Promise<void>
    /** Starts the waiting notes again after Stop, a failed note or a restart. */
    runNext(slug: string): Promise<void>
    clear(slug: string): Promise<void>
    /** Something about a reel's queue changed. */
    onChange(cb: (slug: string) => void): () => void
  }
  cloud: {
    drives(): Promise<CloudDrive[]>
    /** `id` names this save for `cancel` and `onProgress`. A cancelled save rejects with code CANCELLED and leaves no file. */
    save(video: string, folder: string, id: string): Promise<string>
    cancel(id: string): Promise<void>
    onProgress(cb: (p: { id: string; pct: number }) => void): () => void
  }
  phone: {
    /** Start (or restart, e.g. on another network) the link for one exported video. */
    start(video: string, caption: string, address?: string): Promise<PhoneShare>
    stop(): Promise<void>
    onEvent(cb: (e: PhoneEvent) => void): () => void
    /** Open a new email to yourself and show the video in Finder/Explorer to attach it. */
    emailSelf(video: string): Promise<void>
    /** macOS: the Share menu (AirDrop, Messages). Elsewhere: show the file. */
    shareSheet(video: string): Promise<void>
  }
  library: {
    list(): Promise<LibraryBin[]>
    add(paths: string[]): Promise<DropResult[]>
    /** Open the system file picker for songs or pictures and add the picked files. [] = cancelled. */
    choose(kind: 'music' | 'images'): Promise<DropResult[]>
    /** A Library file's contact sheet or waveform (main/library-preview.ts). */
    preview(path: string): Promise<LibraryPreview>
  }
  style: {
    rules(): Promise<StyleRule[]>
    /** A rule typed in My style. */
    add(text: string): Promise<StyleRule>
    remove(id: string): Promise<void>
    /** Undo of remove: the rule back where it was. Only a rule removed in this run of the app. */
    restore(id: string): Promise<void>
    /** Pick Final Cut Pro or Premiere Pro exports and read rules from them; saves nothing. null: the picker was cancelled. */
    learn(): Promise<StyleLesson | null>
    /** Keep these rules from a lesson; each remembers `from`, the export names it was read from. */
    keepLearned(rules: LearnedRule[], from: string): Promise<StyleRule[]>
    /** Change a rule's words, or pause or resume it. */
    update(id: string, patch: { text?: string; paused?: boolean }): Promise<StyleRule>
    /** Answer "Remember this for next time?" on a chat message: Yes saves the rule, No only says so. */
    answer(slug: string, messageId: string, yes: boolean): Promise<void>
    /** "Use lowercase for new reels too", ticked in Edit it myself: the same rule a note's question saves. */
    rememberLowercase(slug: string): Promise<void>
  }
  sfx: {
    /** Every built-in sound effect, with a URL to hear it. */
    pack(): Promise<SoundEffect[]>
  }
  dev: {
    /** Test builds only. `template` defaults to the bundled self-test template. */
    renderTestAnimation(outPath: string, fullSize?: boolean, template?: string, params?: Record<string, unknown>): Promise<string>
  }
  perm: {
    status(): Promise<PermissionStatus>
    allowFolder(): Promise<PermissionStatus>
    /** Turning it on shows one notification, which is when macOS asks. */
    setNotifications(on: boolean): Promise<PermissionStatus>
    /** macOS: the System Settings page for this, with the helper on it. */
    openSettings(pane: SettingsPane): Promise<void>
  }
  /** Updates (main/updater.ts). Downloads and installs only when the person clicks. */
  update: {
    state(): Promise<UpdateState>
    onState(cb: (s: UpdateState) => void): () => void
    check(): Promise<{ checked: boolean; state: UpdateState }>
    download(): Promise<UpdateActionResult>
    install(): Promise<UpdateActionResult>
    openRelease(): Promise<void>
    busy(): Promise<UpdateBusy>
    dismiss(version: string): Promise<UpdateState>
    setEnabled(on: boolean): Promise<void>
  }
}

/**
 * The folder for videos: `not-asked` = not touched yet (touching it is what makes macOS ask), `denied` = macOS
 * privacy said no (EPERM), `unusable` = any other reason it cannot be used (read-only drive, ordinary file rights).
 */
export type FolderAccess = 'not-asked' | 'allowed' | 'denied' | 'unusable'
/**
 * `asking` = turned on, and macOS has not answered yet. `unverified` = turned on in Reel Studio; whether the system
 * shows them cannot be read (main/permissions.ts notifyAccess).
 */
export type NotifyAccess = 'off' | 'asking' | 'unverified' | 'blocked' | 'unsupported'

export interface PermissionStatus {
  folder: FolderAccess
  /** "Documents › Reel Studio" */
  folderDisplay: string
  notifications: NotifyAccess
}

export type SettingsPane = 'folder' | 'notifications'
