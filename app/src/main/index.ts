import { accountName } from './account'
import { versionRows, type VersionRow } from '../shared/version-diff'
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent, Notification } from 'electron'
import { existsSync, promises as fs, appendFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { clipboardFiles, filesFromArgv } from './intake'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertIpcSender, validateIpcArgs } from './ipc-guard'
import {
  appIconPath,
  binDir,
  engineDir,
  engineEnv,
  engineMode,
  ffmpegPath,
  ffprobePath,
  initPaths,
  legalFile,
  noteStagingDir,
  noteStagingRoot,
  projectsDir,
  pythonExe,
  reelStudioRoot,
  setAsrThreads,
  setRootOverride,
  settingsDir
} from './paths'
import { offerMoveToApplications, writeErrorCode } from './move-to-applications'
import { runSelfTest, selfTestArgs, type SelfTestResult } from './self-test'
import { createEngineRunner, killAllEngines, toUserError, type RunEngine } from './engine'
import { logDuration } from './diagnostics'
import { handleMediaProtocol, registerMediaScheme } from './media'
import {
  addChat,
  carryScript,
  createPlanned,
  detail,
  ensureRoot,
  listProjects,
  searchProjects,
  listVersions,
  PLANNED_TITLE,
  PREVIEW_DIR,
  projectDir,
  readAppState,
  readJson,
  readProject,
  readWords,
  serialized,
  titleFromFile,
  uniqueSlug,
  updateAppState,
  writeJson,
  writeProject,
  type AppState
} from './store'
import { addToLibrary, isVideo, listLibrary, uniqueDest } from './library'
import { createJobManager } from './jobs'
import { createNoteQueue, type NoteToRun } from './note-queue'
import { withRenderSlot } from './render-slot'
import { titleVersion } from './version-title'
import { createLiveVideos } from './live-video'
import { replyChat, styleConsent, type ChatLine, answerStyleQuestion, rememberQuestion } from './style-consent'
import type { AgentResult } from './ai-types'
import { loadAI } from './ai'
import type { AI, EngineHost } from './ai-types'
import { closeAnimationRenderer, renderAnimation, TEST_TEMPLATE } from './animation'
import { captureWebsite } from './capture'
import { createModelManager } from './models'
import { createWorkGate } from './work-gate'
import { loadSettings, saveSettings, settleLibraryRoot } from './settings'
import { createPidRegistry } from './orphans'
import { settleLastRun } from './last-run'
import { openSignInWindow, publicInfo } from './claude-signin'
import { aiChoiceSaved, carryOverDecision } from './ai-carryover'
import type { AppInfo, DropResult, ExportResult, JobEvent, ProjectJson, SettingsPane, CoverCandidate, NoteMoment, PlacedWord, PlatformExportResult, VersionInfo } from '../shared/api'
import { COVER_SUGGESTIONS } from '../shared/cover'
import { createCoverScans, parseCoverCandidates } from './cover-scan'
import { noAiReply } from '../shared/notes'
import { aiNoteText, checkMoment, momentRoute, parseMoment, placeWords, typedMoment, type RenderSegment, forPerson } from '../shared/moments'
import { parsePlatformExportRequest, secondTryPlatforms, type Platform, type PlatformTry } from '../shared/platforms'
import { exportPlatforms, sweepExportStaging, type ExportTry } from './platform-export'
import { versionMessage } from '../shared/describe'
import { mergeSourcesPatch } from '../shared/mirror'
import { displayPath } from '../shared/display-path'
import { RELEASES_REPO } from '../shared/config'
import { registerPhoneIpc, stopPhoneShare, cloudSavesRunning, cloudSavesSettled } from './phone-ipc'
import { forChat, pickClipboardType, registerAttachmentIpc, unstage, checkNoteAttachments } from './attachments'
import { RELEASES_API, releasePageBackend, type FetchLike } from './update-check'
import { createPermissions, notificationsWanted, parseFakes, type NotifyResult, type Permissions } from './permissions'
import { helperInstruction, MAC_PANES } from './mac-permission'
import { MacPermissionHelper } from './mac-permission-helper'
import { createUpdater, menuCheckForUpdates } from './updater'
import { autoUpdater } from 'electron-updater'
import { electronUpdaterBackend, macBundleCheck, windowsInstaller } from './updater-electron'
import { disabledReason, updateMode } from './update-machine'
import { createJobFeedback, createMainWindow, feedbackLog, installMenu, startDragOut, windowStateFile, type AppCommand, titleBarOverlay } from './window'
import { takeNote } from './note-intake'

const TEST = process.env.REELSTUDIO_TEST === '1'
const DEV_PROVIDERS = process.env.REELSTUDIO_DEV === '1'
const SELF_TEST = selfTestArgs(process.argv)
const rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
  ? process.env.ELECTRON_RENDERER_URL
  : pathToFileURL(join(__dirname, '../renderer/index.html')).href
if (process.env.REELSTUDIO_USER_DATA) app.setPath('userData', process.env.REELSTUDIO_USER_DATA)
// The self-test must never read or write the person's own data: a throw-away folder stands in for both.
else if (SELF_TEST.selfTest) app.setPath('userData', mkdtempSync(join(tmpdir(), 'reel-studio-self-test-')))
// Test builds: stand-in Documents and Movies folders, so first run makes the real default folder inside them.
if (TEST && process.env.REELSTUDIO_DOCUMENTS) app.setPath('documents', process.env.REELSTUDIO_DOCUMENTS)
if (TEST && process.env.REELSTUDIO_MOVIES) app.setPath('videos', process.env.REELSTUDIO_MOVIES)
// Tests that save a key (safeStorage) must not write to the login keychain of the Mac they run on.
if (TEST && process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain')

registerMediaScheme()

initPaths({
  isPackaged: app.isPackaged,
  resourcesPath: process.resourcesPath,
  documentsDir: app.getPath('documents'),
  moviesDir: app.getPath('videos'),
  userDataDir: app.getPath('userData'),
  appDir: app.getAppPath(),
  rootOverride: SELF_TEST.selfTest ? join(app.getPath('userData'), 'Reel Studio') : null
})

// ---- logging ------------------------------------------------------------------------------------
const logFile = (): string => join(settingsDir(), 'logs', 'main.log')
function log(line: string): void {
  const s = `${new Date().toISOString()} ${line}`
  if (!app.isPackaged) console.log(s)
  try {
    mkdirSync(dirname(logFile()), { recursive: true })
    appendFileSync(logFile(), s + '\n')
  } catch {
    /* logging must never break the app */
  }
}

app.on('render-process-gone', (_event, contents, details) => {
  log(`[render-process-gone] type=Renderer webContentsId=${contents.id} reason=${details.reason} exitCode=${details.exitCode}`)
})
app.on('child-process-gone', (_event, details) => {
  log(`[child-process-gone] type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`)
})
app.on('browser-window-created', (_event, window) => {
  window.on('unresponsive', () => log(`[unresponsive] type=Renderer windowId=${window.id}`))
  window.on('responsive', () => log(`[responsive] type=Renderer windowId=${window.id}`))
})

function showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> {
  return logDuration(`[dialog] ${options.title ?? 'Open folder'}`, log, async () => {
    const result = await dialog.showOpenDialog(win!, options)
    log(`[dialog] returned canceled=${result.canceled} selectedCount=${result.filePaths.length}`)
    return result
  })
}

// ---- engine, AI, jobs ----------------------------------------------------------------------------
let pidRegistry: ReturnType<typeof createPidRegistry> | null = null
const renderSlot = withRenderSlot(
  createEngineRunner({
    python: pythonExe,
    env: engineEnv,
    cwd: engineDir,
    log,
    onSpawn: (pid, project) => pidRegistry?.add(pid, project),
    onExit: (pid) => pidRegistry?.remove(pid)
  }),
  (owner, waiting) => jobs.waitingForRender(owner, waiting)
)
const runEngine: RunEngine = renderSlot.run

const host: EngineHost = {
  runEngine,
  renderAnimation: (template, params, outPath, fps) => renderAnimation(template, params, outPath, fps),
  captureWebsite: (url, outPath, opts) => captureWebsite(url, outPath, opts),
  reelStudioRoot
}

let ai: AI
let perms: Permissions
let aiSource: 'package' | 'mock' = 'mock'
let win: BrowserWindow | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload)
}

// The window, menu, Dock/taskbar and notifications (window.ts) hear about every job too.
const sendCommand = (c: AppCommand): void => broadcast('app:command', c)
let notificationsOn = true
const feedback = createJobFeedback({
  window: () => win,
  title: async (slug) => (await readProject(slug).catch(() => null))?.title || slug,
  send: sendCommand,
  test: TEST,
  notificationsOn: () => notificationsOn
})
if (TEST) (globalThis as { __reelFeedback?: unknown }).__reelFeedback = feedbackLog
// Under test, a paste reads these stand-in items (the e2e sets them), never the system clipboard.
const testClipboard: { items: Electron.ClipboardItem[] } = { items: [] }
if (TEST) (globalThis as { __reelClipboard?: unknown }).__reelClipboard = testClipboard
const workGate = createWorkGate()
// Honest progress (main/progress.ts): phase times measured on this computer, per minute of video.
const speedHistoryFile = (): string => join(settingsDir(), 'speed-history.json')
const jobs = createJobManager(
  (e: JobEvent) => {
    broadcast('job:event', e)
    feedback.onJobEvent(e)
    noteQueue.onJobEvent(e)
  },
  log,
  {
    profile: async (kind) => {
      if (kind !== 'first-edit') return kind
      const provider = await ai.active().catch(() => null)
      return provider?.connected && provider.id !== 'none' ? kind : 'first-edit-basic'
    },
    loadHistory: async () => JSON.parse(await fs.readFile(speedHistoryFile(), 'utf8')),
    saveHistory: (h) => writeJson(speedHistoryFile(), h),
    mediaSeconds: async (slug) =>
      ((await readProject(slug)).sources ?? []).reduce((a: number, s: { duration?: number }) => a + (Number(s?.duration) || 0), 0)
  },
  // render events carry a playable URL (a stable copy for drafts: main/live-video.ts)
  ((live) => (slug: string, e) => live(projectDir(slug), e))(createLiveVideos()),
  workGate,
  () => updates.assertCanStartWork()
)

/** A note job: the AI applies it as one all-or-nothing change (ai applyNote) on the newest version. */
async function startNote(slug: string, { id: noteId, text, attachments, moment }: NoteToRun, record: (s: AppState) => void): Promise<string> {
  const dir = projectDir(slug)
  return jobs.start(
    slug,
    'note',
    async (emit, signal, { id: jobId, owner }) => {
      await unstage(dir, noteStagingDir(dir), attachments)
      const before = (await readProject(slug)).version ?? 0
      // saved under its queue entry's id (note-queue.ts), with the job's id in its version's receipt; the app asks
      // before anything goes into My style
      const checkEdit = (await loadSettings()).checkEdits // Settings > "Double-check each edit"
      const opts = { attachments: attachments.map((f) => f.asset), id: noteId, jobId, checkEdit, saveStyleRules: false, ...(owner ? { owner } : {}) }
      // the AI reads the moment in the note text: "At 0:08 (around "...", words w18, w19): cut this part";
      // what it says back while it works reaches the progress card in the person's own words
      const aiText = aiNoteText(text, moment)
      const r: AgentResult = await ai.applyNote(dir, aiText, forPerson(emit, aiText, text), signal, opts)
      if (r.changed.length && r.version !== undefined && ai.rewordVersion) {
        void titleVersion(slug, r.version, ai.rewordVersion.bind(ai), AbortSignal.timeout(60_000)).catch((e) =>
          log(`[ai] version title: ${String(e?.message ?? e)}`)
        )
      }
      const extra = r.notice?.userMessage ? ` ${r.notice.userMessage}` : ''
      const reply = await replyAskingAboutStyle(r, r.summary + extra)
      // a note that changed only the caption keeps its version number (docs/versions.md), so `changed` decides
      const changedIt = (r.version ?? 0) > before || r.changed.length > 0
      return { ...reply, outcome: changedIt ? 'done' : 'failed', made: { by: 'note', summary: text } }
    },
    { note: text || attachments.map((f) => f.name).join(', '), record }
  )
}
const noteQueue = createNoteQueue({ jobs, startNote, changed: (slug) => broadcast('queue:change', slug), log })

const models = createModelManager({
  runEngine,
  onChange: (s) => broadcast('model:progress', s),
  loadCheck: async () => (await loadSettings()).speechCheck,
  saveCheck: async (speechCheck) => void (await saveSettings({ speechCheck })),
  useThreads: setAsrThreads,
  gate: workGate,
  // The engine stops starting new counts after 15 s, and one count took at most about 7 s on a busy M4 Pro, so a
  // check still running after a minute is stuck.
  checkDeadlineMs: 60_000,
  log
})
const coverScans = createCoverScans(runEngine)
// ---- updates (main/updater.ts) -------------------------------------------------------------------
// Test runs never touch the network, except the update e2e, which points a dev build at a local server
// (REELSTUDIO_UPDATE_FEED, honoured only in an unpackaged test run: app/e2e/update.spec.ts).
const TEST_FEED = TEST && !app.isPackaged ? process.env.REELSTUDIO_UPDATE_FEED : undefined
let exportsWriting = 0
const updateBusy = () => ({ exporting: exportsWriting > 0, working: jobs.runningCount() })

function readUpdateFeed(): string | null {
  if (TEST_FEED) {
    // electron-updater's dev config: same format as the packaged app-update.yml, generic provider
    const file = join(app.getPath('userData'), 'dev-app-update.yml')
    const text = `provider: generic\nurl: ${TEST_FEED}\nupdaterCacheDirName: reel-studio-e2e-updater-${basename(dirname(app.getPath('userData')))}\n`
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
    return file
  }
  const file = join(process.resourcesPath, 'app-update.yml')
  return existsSync(file) ? file : null
}

const updateFeed = app.isPackaged || TEST_FEED ? readUpdateFeed() : null
const updateEnv = {
  platform: process.platform,
  isPackaged: app.isPackaged || !!TEST_FEED,
  test: (TEST && !TEST_FEED) || SELF_TEST.selfTest,
  hasFeed: updateFeed !== null,
  inApplications: !!TEST_FEED || (app.isPackaged && process.platform === 'darwin' && app.isInApplicationsFolder())
}
// Node's fetch: no Electron session, so no cookies ride along
const githubFetch: FetchLike = (url, init) => fetch(url, init)
const updateOff = disabledReason(updateEnv)
const updateHow = updateMode(updateEnv)
const updates = createUpdater({
  version: app.getVersion(),
  mode: updateHow,
  disabledReason: updateOff,
  backend: updateOff
    ? null
    : updateHow === 'install'
      ? electronUpdaterBackend({
          updater: autoUpdater,
          version: app.getVersion(),
          fetch: githubFetch,
          releasesApi: TEST_FEED ? `${TEST_FEED}/releases` : RELEASES_API,
          releaseFolder: (tag) => (TEST_FEED ? `${TEST_FEED}/download/${tag}` : `https://github.com/${RELEASES_REPO}/releases/download/${tag}`),
          log,
          devFeedFile: TEST_FEED ? updateFeed ?? undefined : undefined,
          onError: (e) => updates.installFailed(e),
          install: process.platform === 'win32' ? windowsInstaller : macBundleCheck(app.getVersion())
        })
      : releasePageBackend(githubFetch, app.getVersion()),
  load: loadSettings,
  save: saveSettings,
  busy: updateBusy,
  prepareToQuit: async () => {
    await stopPhoneShare()
    await jobs.cancelAll()
    await killAllEngines()
  },
  openExternal: (url) => shell.openExternal(url),
  send: (st) => broadcast('update:state', st),
  log,
  now: () => Date.now()
})
log(`[update] ${updateOff ?? `on (${updateHow})`}`)

// ---- helpers ------------------------------------------------------------------------------------
type Handler = (e: IpcMainInvokeEvent, ...args: any[]) => unknown

/** Every IPC call returns {ok, value} or {ok:false, error:{code,userMessage}} so errors stay friendly. */
function handle(channel: string, fn: Handler): void {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      assertIpcSender(e, win?.webContents, rendererUrl)
      validateIpcArgs(channel, args)
      return { ok: true, value: await fn(e, ...args) }
    } catch (err) {
      const u = toUserError(err)
      log(`[ipc ${channel}] ${u.code}: ${u.message ?? u.userMessage}`)
      const link = (err as { link?: unknown })?.link
      return { ok: false, error: { code: u.code, userMessage: u.userMessage, ...(typeof link === 'string' ? { link } : {}) } }
    }
  })
}

const rootDisplay = (root: string): string =>
  displayPath(root, { documents: app.getPath('documents'), desktop: app.getPath('desktop'), home: app.getPath('home') }, process.platform)

// Read once: the sidebar shows it on every screen. Tests show no name, so screenshots never carry one.
let accountNameRead: Promise<string | null> | null = null

async function appInfo(): Promise<AppInfo> {
  const s = await loadSettings()
  accountNameRead ??= TEST ? Promise.resolve(null) : accountName()
  // The real long path, never an 8.3 short name like USERNA~1 (design critique 1.9). Not during first run: the
  // folder is not made yet, and looking inside Documents before setup explains why is what makes macOS ask.
  let root = reelStudioRoot()
  try {
    if (s.firstRunDone) root = realpathSync.native(root)
  } catch {
    /* not created yet: show it as configured */
  }
  return {
    version: app.getVersion(),
    platform: process.platform,
    root,
    rootDisplay: rootDisplay(root),
    firstRunDone: s.firstRunDone,
    fasterExports: s.fasterExports,
    engine: { mode: engineMode(), dir: engineDir(), python: pythonExe() },
    ai: aiSource,
    test: TEST,
    dev: DEV_PROVIDERS,
    userName: await accountNameRead,
    models: s.models,
    sharing: s.sharing,
    phoneView: s.phoneView
  }
}

/** Engine arguments for a command a job runs: it joins the job's ownership of the project. */
function owned(args: string[], owner: string | null): string[] {
  return owner ? [...args, '--owner', owner] : args
}

/** `basic`: the version is made without the editor (a failed Version 1's "Make a basic version"). */
function startFirstEdit(slug: string, initArgs: { title: string; files: string[] } | null, basic = false): string {
  const dir = projectDir(slug)
  return jobs.start(slug, 'first-edit', async (emit, signal, { owner }) => {
    if (initArgs && !existsSync(join(dir, 'project.json'))) {
      const { fasterExports } = await loadSettings()
      emit({ type: 'status', message: 'Copying your video', pct: 0 })
      await runEngine(
        'init',
        owned(['--project', dir, '--title', initArgs.title, '--slug', slug, ...(fasterExports ? ['--faster-exports'] : [])], owner).concat(initArgs.files),
        (p) => emit({ type: 'status', message: 'Copying your video', pct: Math.round(p.pct * 0.01) }),
        signal
      )
    }
    // a reel planned before it had a video: the editor reads its script from project.json (again on a resume,
    // in case the app closed between the copy and this)
    await carryScript(slug)
    const provider = basic ? null : await ai.active().catch(() => null)
    // A render event with firstLook = the quick no-AI draft is ready while the AI keeps editing; the
    // Reel screen plays it (shared/live.ts) and says what it is. Once listening is done (the first
    // status of a later phase), the words heard go to the Reel screen ("I heard: ...").
    let heard = false
    const r = await ai.firstEdit(
      dir,
      (e) => {
        emit(e)
        if (!heard && e.type === 'status' && e.phase && e.phase !== 'listen') {
          heard = true
          void readProject(slug)
            .then((p) => readWords(dir, p))
            .then((w) => w.length && emit({ type: 'heard', words: w.map((x) => x.w) }))
            .catch(() => undefined)
        }
      },
      signal,
      { ...(owner ? { owner } : {}), ...(basic ? { basic } : {}) }
    )
    // Honest "What I did": only an AI that ran to the end picked the takes and wrote the caption.
    // A notice means it stopped and (usually) the simple edit stepped in, so claim nothing.
    const aiEdited = !!provider && provider.connected && provider.id !== 'none' && !r.notice
    await updateAppState(slug, (s) => {
      s.aiEdited = aiEdited
    })
    if (r.notice?.userMessage) await addChat(slug, 'editor', r.notice.userMessage)
    return replyAskingAboutStyle(r, r.summary)
  })
}

/** The editor's reply into the chat, then one "Remember this for next time?" per My style rule the AI
 * proposed or saved (a saved one is taken out again until the user says Yes): main/style-consent.ts. */
async function replyAskingAboutStyle(r: AgentResult, summary: string): Promise<{ summary: string; version?: number; chat: ChatLine[] }> {
  const c = styleConsent(summary, r.styleRulesAdded, r.styleSuggestions, r.styleProposal)
  if (c.undo.length) {
    const rules = await ai.styleRules().catch(() => [])
    // a typed rule was saved with the person's Yes; only sentences the AI saved on its own are undone
    for (const rule of rules) if (c.undo.includes(rule.text) && !rule.payload) await ai.removeStyleRule(rule.id).catch(() => undefined)
  }
  return { summary: c.summary, version: r.version, chat: replyChat(c, r.version, r.styleProposal) }
}

const EDITABLE: (keyof ProjectJson)[] = ['title', 'cut', 'captions', 'music', 'broll', 'zooms', 'cover', 'post']

function safeFileName(s: string): string {
  const t = s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return t.slice(0, 80) || 'My video'
}

async function finishedExportVersion(slug: string, n: number): Promise<VersionInfo> {
  const dir = projectDir(slug)
  let versions = await listVersions(dir)
  let v = versions.find((x) => x.n === n) ?? versions[versions.length - 1]
  if (!v) throw { code: 'NO_VERSION', userMessage: 'This video is not ready yet. Wait for it to finish, then try again.' }
  if (jobs.forSlug(slug)) throw { code: 'BUSY', userMessage: 'I am still working on this video. Wait until it is done, then export.' }
  if (v.draft) {
    // A preview is not the full-quality file: make it first, as a normal job (progress, Stop, and
    // nothing else can run on this video meanwhile) (review 25).
    let stopped: AbortSignal | undefined
    jobs.start(slug, 'rerender', async (emit, signal, { id, owner }) => {
      stopped = signal
      emit({ type: 'status', message: 'Making the full-quality video', pct: 1, phase: 'final' })
      const r: any = await runEngine(
        'render',
        owned(['--project', dir, '--job-id', id], owner),
        (pr) => emit({ type: 'status', message: pr.message || 'Making the full-quality video', pct: pr.pct, phase: 'final' }),
        signal
      )
      const version = Number(r?.version ?? 0)
      emit({ type: 'render', version, draft: false })
      return { summary: '', version, chat: [] }
    })
    await jobs.forSlug(slug)?.done
    if (stopped?.aborted) throw { code: 'CANCELLED', userMessage: 'Stopped.' }
    versions = await listVersions(dir)
    v = versions[versions.length - 1]
    if (!v || v.draft) throw { code: 'EXPORT_FAILED', userMessage: 'I could not make the full-quality video. Try Export again.' }
  }
  return v
}

async function exportVersion(slug: string, n: number): Promise<ExportResult> {
  const v = await finishedExportVersion(slug, n)
  const p = await readProject(slug)
  const exportsDir = binDir('exports')
  await fs.mkdir(exportsDir, { recursive: true })
  // "<title> - Version 2.mp4": the same words as the version buttons, never a bare "(2)".
  const name = `${safeFileName(p.title || slug)} - Version ${v.n}`
  const video = uniqueDest(exportsDir, `${name}.mp4`)
  const stem = basename(video, '.mp4')
  await fs.copyFile(v.videoPath, video)
  let cover: string | null = null
  const coverSrc = join(dirname(v.videoPath), 'cover.png')
  if (existsSync(coverSrc)) {
    cover = join(exportsDir, `${stem} cover.png`)
    await fs.copyFile(coverSrc, cover)
  }
  const tags = (Array.isArray(p.post?.hashtags) ? p.post!.hashtags : [])
    .map((h) => String(h))
    .map((h) => (h.startsWith('#') ? h : `#${h}`))
    .join(' ')
  const caption = [p.post?.caption ?? '', tags].filter(Boolean).join('\n\n')
  const captionFile = join(exportsDir, `${stem} caption.txt`)
  await fs.writeFile(captionFile, caption + '\n', 'utf8')
  if (!TEST) shell.showItemInFolder(video)
  return { folder: exportsDir, video, cover, captionFile, caption }
}

// ---- IPC ----------------------------------------------------------------------------------------
// Every word version `n` (0 = the Preview) plays, placed by that render's own timeline: the segments
// the engine cut it from (render.json segmentsDetail, docs/versions.md). null when the version or its
// timeline is missing.
async function readTimeline(slug: string, n: number): Promise<{ duration: number; words: PlacedWord[]; segments: RenderSegment[] } | null> {
  const dir = projectDir(slug)
  const file = n === 0 ? join(dir, 'versions', PREVIEW_DIR, 'render_draft.json') : join(dir, 'versions', `v${n}`, 'render.json')
  const r = await readJson<{ duration?: number; segmentsDetail?: RenderSegment[] }>(file, {})
  if (typeof r.duration !== 'number' || !r.segmentsDetail?.length) return null
  const words = await readWords(dir, await readProject(slug))
  return { duration: r.duration, words: placeWords(r.segmentsDetail, words), segments: r.segmentsDetail }
}

// Before → after rows for version `n`: its saved project.json against the version before it, or for
// Version 1 against the raw video. null when the version's own snapshot is gone.
async function readVersionRows(slug: string, n: number): Promise<VersionRow[] | null> {
  const dir = projectDir(slug)
  const snap = (v: number) => readJson<ProjectJson | null>(join(dir, 'versions', `v${v}`, 'project.json'), null)
  const length = async (v: number) => (await readJson<{ duration?: number }>(join(dir, 'versions', `v${v}`, 'render.json'), {})).duration ?? null
  const after = await snap(n)
  if (!after) return null
  if (n === 1) {
    const raw = (after.sources ?? []).reduce((t, s) => t + (s.duration ?? 0), 0)
    return versionRows(null, after, { before: raw > 0 ? raw : null, after: await length(1) })
  }
  const before = await snap(n - 1)
  return before ? versionRows(before, after, { before: await length(n - 1), after: await length(n) }) : null
}

function registerIpc(): void {
  handle('app:info', () => appInfo())
  handle('app:setModels', async (_e, m: unknown) => {
    const ok = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200 && !v.includes('\0')
    const x = (m ?? {}) as Record<string, unknown>
    if (!ok(x.editor) || !ok(x.checker) || !ok(x.writer)) throw { code: 'BAD_INPUT', userMessage: 'Choose a model for each part.' }
    await saveSettings({ models: { editor: x.editor as string, checker: x.checker as string, writer: x.writer as string } })
    return appInfo()
  })
  handle('app:setSharing', async (_e, v: unknown) => {
    const x = (v ?? {}) as Record<string, unknown>
    const keys = ['asked', 'on', 'usage', 'quality', 'posts'] as const
    if (!keys.every((k) => typeof x[k] === 'boolean')) throw { code: 'BAD_INPUT', userMessage: 'Choose what to share.' }
    await saveSettings({ sharing: Object.fromEntries(keys.map((k) => [k, x[k]])) as Record<(typeof keys)[number], boolean> })
    return appInfo()
  })
  handle('app:setPhoneView', async (_e, view: unknown) => {
    if (view !== 'instagram' && view !== 'clean') throw { code: 'BAD_INPUT', userMessage: 'Choose Instagram or Clean.' }
    await saveSettings({ phoneView: view })
    return appInfo()
  })
  handle('app:setFasterExports', async (_e, on: boolean) => {
    if (typeof on !== 'boolean') throw { code: 'BAD_INPUT', userMessage: 'Choose whether to use faster exports.' }
    await saveSettings({ fasterExports: on })
    return appInfo()
  })
  handle('app:clipboardFiles', () => clipboardFiles(TEST ? async () => testClipboard.items : undefined))
  handle('app:takeOpenFiles', async () => (await loadSettings()).firstRunDone ? pendingOpenFiles.splice(0) : [])
  handle('app:finishFirstRun', async () => {
    // Windows and Linux skip the "Your Mac" stage, so their folder is made here (on a Mac it already exists).
    await ensureRoot().catch((e) => log(`[root] ${String(e)}`))
    perms.markTouched()
    const s = await loadSettings()
    // A new Mac user who never turned on "Tell me when a video is ready" said no (main/permissions.ts).
    const patch = process.platform === 'darwin' && s.notifications === null ? { notifications: false } : {}
    const next = await saveSettings({ firstRunDone: true, ...patch })
    notificationsOn = notificationsWanted(next, process.platform)
  })
  handle('app:openFolder', async (_e, p: string) => {
    if (TEST) return
    const st = await fs.stat(p).catch(() => null)
    if (st?.isDirectory()) await shell.openPath(p)
    else shell.showItemInFolder(p)
  })
  handle('app:copyText', (_e, t: string) => clipboard.writeText(String(t)))
  handle('app:legal', (_e, doc: unknown) => fs.readFile(legalFile(doc), 'utf8'))
  handle('app:showLegal', (_e, doc: unknown) => {
    const file = legalFile(doc)
    if (!TEST) shell.showItemInFolder(file)
  })
  handle('app:dimTitleBar', (_e, on: boolean) => {
    if (process.platform !== 'darwin' && win && !win.isDestroyed()) win.setTitleBarOverlay(titleBarOverlay(on === true))
  })
  ipcMain.on('app:startDrag', (e, file: string) => {
    try {
      assertIpcSender(e, win?.webContents, rendererUrl)
      validateIpcArgs('app:startDrag', [file])
      startDragOut(e.sender, file, [reelStudioRoot(), projectsDir()])
    } catch (err) {
      log(`[drag] ${String(err)}`)
    }
  })
  handle('app:chooseFolder', async () => {
    const r = await showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('app:setRoot', async (_e, p: string) => {
    if (jobs.runningCount()) throw { code: 'BUSY', userMessage: 'Wait until your video is finished, then change where videos are kept.' }
    const root = basename(p) === 'Reel Studio' ? p : join(p, 'Reel Studio')
    await fs.mkdir(root, { recursive: true })
    await saveSettings({ root })
    setRootOverride(root)
    await ensureRoot()
    perms.markTouched()
    return appInfo()
  })

  handle('perm:status', () => perms.status())
  handle('perm:allowFolder', () => perms.allowFolder())
  handle('perm:openSettings', (_e, pane: unknown) => perms.openSettings(pane))
  handle('perm:setNotifications', async (_e, on: unknown) => {
    const st = await perms.setNotifications(on === true)
    notificationsOn = notificationsWanted(await loadSettings(), process.platform)
    return st
  })

  registerPhoneIpc({ handle, roots: () => [reelStudioRoot(), projectsDir()], send: broadcast, log, test: TEST })
  // pictures, GIFs and clips on a note (main/attachments.ts)
  registerAttachmentIpc({
    handle,
    runEngine,
    log,
    projectDir,
    readProject,
    busy: (slug) => jobs.isClosed(slug),
    refuse: (slug) => jobs.refuseIfKeptClosed(slug),
    stagingDir: (slug) => noteStagingDir(projectDir(slug)),
    clipboardImage: async () => {
      // Electron's async clipboard: the first item that carries a picture, as bytes
      for (const item of await clipboard.read()) {
        const type = pickClipboardType(item.types)
        if (!type) continue
        const blob = await item.getType(type)
        if (blob instanceof Blob) return { mime: type, bytes: new Uint8Array(await blob.arrayBuffer()) }
      }
      return null
    },
    choose: async (filters) => {
      const r = await showOpenDialog({ title: 'Attach a picture or a clip', properties: ['openFile', 'multiSelections'], filters })
      return r.canceled ? null : r.filePaths
    }
  })

  handle('model:status', () => models.status())
  handle('model:download', () => models.download())
  handle('model:find', () => models.find())
  handle('model:cancel', () => models.cancel())

  handle('ai:providers', () => ai.providers())
  handle('ai:active', () => ai.active())
  // Done or failed, every call that can change the AI editor announces it so the sidebar line follows at once.
  const changesAI = (channel: string, fn: Handler): void =>
    handle(channel, async (e, ...args) => {
      try {
        return await fn(e, ...args)
      } finally {
        ai.active().then((p) => broadcast('ai:change', p), () => {})
      }
    })
  changesAI('ai:setActive', (_e, id, connectionId?: string) => ai.setActive(id, typeof connectionId === 'string' ? connectionId : undefined))
  changesAI('ai:signInChatGPT', () => ai.signInChatGPT((url) => shell.openExternal(url)))
  handle('ai:cancelSignIn', () => ai.cancelSignInChatGPT?.())
  changesAI('ai:signOutChatGPT', () => ai.signOutChatGPT())
  changesAI('ai:setClaudeKey', (_e, key: string | null) => ai.setClaudeKey(key))
  // The key goes from the page to the AI package once and never comes back.
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const connectionsNotReady = { code: 'NOT_READY', userMessage: 'Connecting your own AI server is not ready in this build yet. Your videos still work without it.' }
  handle('ai:connections', async () => (await ai.connections?.()) ?? [])
  changesAI('ai:saveConnection', async (_e, input: Record<string, unknown>) => {
    if (!ai.saveConnection) throw connectionsNotReady
    const kind = input?.kind === 'anthropic' ? 'anthropic' : 'openai'
    return ai.saveConnection({ ...(input?.id ? { id: text(input.id) } : {}), label: text(input?.label), kind, baseURL: text(input?.baseURL), model: text(input?.model), key: text(input?.key) })
  })
  changesAI('ai:removeConnection', async (_e, id: unknown) => {
    if (!ai.removeConnection) throw connectionsNotReady
    await ai.removeConnection(text(id))
  })
  handle('ai:setConnectionImages', async (_e, id: unknown, on: unknown) => {
    if (!ai.setConnectionImages) throw connectionsNotReady
    await ai.setConnectionImages(text(id), on === true)
  })
  handle('ai:connectionModels', async (_e, q: Record<string, unknown>) => {
    if (!ai.connectionModels) return { models: [], suggested: null, needsKey: false }
    const kind = q?.kind === 'anthropic' ? 'anthropic' : 'openai'
    return ai.connectionModels({ kind, baseURL: text(q?.baseURL), key: text(q?.key), ...(q?.id ? { id: text(q.id) } : {}) })
  })
  // The person's own Claude Code app: the page gets the state only; the sign-in happens in Anthropic's CLI.
  const claudeCode = async () => (await ai.claudeCodeStatus?.()) ?? { state: 'missing' as const }
  handle('ai:claudeCodeStatus', async () => publicInfo(await claudeCode()))
  handle('ai:checkEdits', async () => (await loadSettings()).checkEdits)
  handle('ai:setCheckEdits', async (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw { code: 'BAD_INPUT', userMessage: 'That setting needs on or off.' }
    return (await saveSettings({ checkEdits: on })).checkEdits
  })
  handle('ai:openClaudeSignIn', async () => {
    const st = await claudeCode()
    if (st.state === 'ready') return
    const open = aiSource === 'mock' ? async () => (ai.mockClaudeSignInOpened?.(), '') : (f: string) => shell.openPath(f)
    await openSignInWindow(st.bin, { dir: join(settingsDir(), 'claude-sign-in'), platform: process.platform, open })
  })

  handle('projects:list', () => listProjects())
  handle('projects:search', (_e, query: string) => searchProjects(query))
  handle('projects:get', async (_e, slug: string) => {
    const d = await detail(slug)
    const running = jobs.forSlug(slug)
    d.job = running
      ? { id: running.id, kind: running.kind, message: jobs.message(running), pct: running.pct, overall: running.overall, secondsLeft: running.secondsLeft, overdue: running.overdue, thinking: running.thinking, waitingForRender: running.waitingForRender, steps: running.steps }
      : null
    if (!running && d.status === 'working') d.status = 'interrupted'
    return d
  })
  /** The videos among dropped or picked files; anything else goes to the Library. Throws when there is no video. */
  const takeVideos = async (files: string[]): Promise<{ videos: string[]; skipped: DropResult[] }> => {
    const videos = files.filter(isVideo)
    const others = files.filter((f) => !isVideo(f))
    const skipped: DropResult[] = others.length ? await addToLibrary(others, runEngine, log) : []
    if (!videos.length) {
      const sorted = skipped.filter((s) => s.bin)
      throw {
        code: 'NO_VIDEO',
        userMessage: sorted.length
          ? 'That was not a video, so I put it in your Library. Drop a video file (like .mp4 or .mov) to make a reel.'
          : 'Drop a video file (like .mp4 or .mov) to make a reel.'
      }
    }
    for (const v of videos) {
      if (!(await fs.stat(v).catch(() => null))?.isFile()) {
        throw { code: 'NOT_FOUND', userMessage: `I could not open "${basename(v)}". Check that the file is still there and try again.` }
      }
    }
    await ensureRoot()
    return { videos, skipped }
  }
  handle('projects:create', async (_e, files: string[]) => {
    const { videos, skipped } = await takeVideos(files)
    const title = titleFromFile(videos[0])
    const slug = await uniqueSlug(title)
    await fs.mkdir(projectDir(slug), { recursive: true })
    await updateAppState(slug, (s) => {
      s.status = 'working'
      s.title = title
    })
    const jobId = startFirstEdit(slug, { title, files: videos })
    return { slug, jobId, skipped }
  })
  handle('projects:plan', async () => ({ slug: await createPlanned() }))
  handle('projects:addVideo', async (_e, slug: string, files: string[]) => {
    const st = await readAppState(slug)
    if (st.status !== 'planned') throw { code: 'HAS_VIDEO', userMessage: 'This reel already has its video. Drop it on Reels to make a new reel.' }
    const { videos, skipped } = await takeVideos(files)
    const title = st.title && st.title !== PLANNED_TITLE ? st.title : titleFromFile(videos[0])
    await updateAppState(slug, (s) => void (s.title = title))
    // refused while a script is still being written; the reel stays planned until its first edit starts
    return { jobId: startFirstEdit(slug, { title, files: videos }), skipped }
  })
  // The editor writes a script for a planned reel. Its title becomes the reel's, unless the person named it.
  handle('projects:script', async (_e, slug: string, idea: string) => {
    const words = String(idea ?? '').trim()
    if (!words) throw { code: 'EMPTY', userMessage: 'Say what the reel is about in a sentence or two first.' }
    const active = await ai.active().catch(() => null)
    if (!active?.connected || active.id === 'none') throw { code: 'NO_AI', userMessage: 'Connect an editor to get a script.' }
    let jobId = ''
    jobId = jobs.start(
      slug,
      'script',
      async (emit, signal) => {
        const r = await ai.writeScript(words, emit, signal)
        const title = r.title?.trim().slice(0, 80)
        if (title) await updateAppState(slug, (s) => void (s.title === PLANNED_TITLE && (s.title = title)))
        return { summary: r.hook, chat: [{ from: 'editor', text: r.hook, plan: true, script: r }] }
      },
      { record: (s) => void s.chat.push(stamp({ from: 'you', text: words, plan: true, jobId })) }
    )
    return { jobId }
  })
  handle('projects:resume', async (_e, slug: string, basic?: boolean) => {
    const dir = projectDir(slug)
    if (!existsSync(join(dir, 'project.json'))) {
      throw { code: 'CANNOT_RESUME', userMessage: 'This video never finished copying. Delete it and drop the video in again.' }
    }
    return { jobId: startFirstEdit(slug, null, basic === true) }
  })
  handle('projects:note', async (_e, slug: string, text: string, attachments?: unknown, at?: unknown, onVersion?: unknown) => {
    const dir = projectDir(slug)
    // never trust the page: every attached ref is re-read from THIS project's own sidecars or its staging folder, and
    // a video kept closed refuses the note before the queue or the chat shows it (note-intake.ts)
    const { note: typedText, files } = await takeNote(jobs, slug, text, attachments)
    // "At 1:00: zoom in" with Just here: the typed time is the moment, and the words are the note
    const typed = at !== undefined ? typedMoment(typedText) : null
    let note = typed ? typed.rest : typedText
    if (!note && !files.length) throw { code: 'EMPTY', userMessage: 'Type what you would like changed first.' }
    if (!note && typed) note = 'Put this here' // a typed time and a file, as the pop-up says it
    let moment: NoteMoment | undefined
    if (at !== undefined) {
      let asked: NoteMoment
      try {
        asked = parseMoment(at)
      } catch (e) {
        throw { code: 'BAD_MOMENT', message: String(e), userMessage: 'I lost track of that moment. Open "Change something" again and resend.' }
      }
      if (typed) asked = { ...asked, at: typed.at }
      // checked against the render it names, the one the pop-up read its words from; its words and
      // quote come from that render, never from the page
      const c = checkMoment(asked, await readTimeline(slug, asked.version))
      if ('refuse' in c) throw { code: 'BAD_MOMENT', userMessage: c.refuse }
      moment = c.moment
      if (moment.words.join() !== asked.words.join()) log(`[note] moment words from the page (${asked.words.join(' ')}) differ from the render's; using the render's`)
      // A setting global by nature ("smaller captions") goes without its moment, which would hide it
      // from applyNote's no-model fast path; the chat shows the words as typed.
      if (!files.length && (await momentRoute(typedText, (w) => ai.wholeReelSetting(dir, w))) === 'fast') moment = undefined
    }
    const active = await ai.active().catch(() => null)
    if (!active || !active.connected || active.id === 'none') {
      // No AI editor: nothing can apply the note, so do not pretend. Say what they can do instead
      // and offer the matching manual control plus "Connect ChatGPT" (grandma test, finding 8).
      // the chat keeps the words as typed, "At 0:05:" included
      await addChat(slug, 'you', typedText, undefined, undefined, undefined, files.map(forChat), moment)
      const reply = noAiReply(note, files.length)
      await addChat(slug, 'editor', reply.text, undefined, reply.actions)
      return { jobId: null }
    }
    // the queue entry carries the moment: its chat line shows it and the AI reads it (startNote)
    const seen = Number.isInteger(onVersion) ? Number(onVersion) : (moment?.version ?? (await readProject(slug)).version ?? 0)
    return noteQueue.send(slug, { text: note, attachments: files.map(forChat), ...(moment ? { moment } : {}) }, seen)
  })
  handle('projects:versionRows', async (_e, slug: string, n: number) => {
    if (!Number.isInteger(n) || n < 1) throw { code: 'BAD_VERSION', userMessage: 'Pick a version of your video first.' }
    return readVersionRows(slug, n)
  })
  handle('projects:timeline', async (_e, slug: string, n: number) => {
    if (!Number.isInteger(n) || n < 0) throw { code: 'BAD_VERSION', userMessage: 'Pick a version of your video first.' }
    return readTimeline(slug, n)
  })
  handle('projects:update', async (_e, slug: string, patch: Partial<ProjectJson>) => {
    // a reel with no video yet has no project.json: only its name can change
    if (!existsSync(join(projectDir(slug), 'project.json'))) {
      const title = typeof patch?.title === 'string' ? patch.title.trim().slice(0, 120) : ''
      if (title) await updateAppState(slug, (s) => void (s.title = title))
      return detail(slug)
    }
    return jobs.hold(slug, async () => {
      const p = await readProject(slug)
      for (const k of Object.keys(patch ?? {}) as (keyof ProjectJson)[]) {
        // the "Flip picture" toggle: only each take's mirror flag, never its path or size
        if (k === 'sources') {
          p.sources = mergeSourcesPatch(p.sources, patch.sources)
          continue
        }
        if (!EDITABLE.includes(k)) continue
        ;(p as any)[k] = (patch as any)[k]
      }
      await writeProject(slug, p)
      return detail(slug)
    })
  })
  // `change` = what the user changed, in plain words ("bigger yellow subtitles"), for the chat and the version button.
  // A manual change is render-only (no AI), called what it is ("Updating your subtitles", never the engine's
  // own step names like "Adding pictures"), and fast to SEE: a half-size preview first (the Reel screen plays
  // it), then the full-quality version (grandma 2: a colour change took 3 minutes and said "Adding pictures").
  handle('projects:rerender', async (_e, slug: string, change?: string, label?: string) => {
    const dir = projectDir(slug)
    const words = typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : 'Updating your video'
    const jobId = jobs.start(slug, 'rerender', async (emit, signal, { id, owner }) => {
      emit({ type: 'status', message: words, pct: 1, phase: 'final', aggregate: true })
      const look: any = await runEngine(
        'render',
        owned(['--project', dir, '--draft', '--no-cover'], owner),
        (p) => {
          if (p.stage === 'render') emit({ type: 'status', message: words, pct: Math.round(p.pct * 0.3), phase: 'final', aggregate: true })
        },
        signal
      )
      emit({ type: 'render', version: Number(look?.version ?? 0), draft: true, ...(look?.file ? { file: String(look.file) } : {}) })
      const r: any = await runEngine(
        'render',
        owned(['--project', dir, '--job-id', id], owner),
        (p) => {
          if (p.stage === 'render') emit({ type: 'status', message: words, pct: 30 + Math.round(p.pct * 0.7), phase: 'final', aggregate: true })
        },
        signal
      )
      const version = Number(r?.version ?? (await readProject(slug)).version)
      emit({ type: 'render', version, draft: false, ...(r?.file ? { file: String(r.file) } : {}) })
      const what = typeof change === 'string' ? change.slice(0, 200) : ''
      return { summary: versionMessage(version, what), version, made: { by: 'hand', summary: what } }
    })
    return { jobId }
  })
  handle('projects:export', async (_e, slug: string, n: number) => {
    updates.assertCanStartWork()
    exportsWriting++ // the updater will not restart the app while an export writes its file
    try {
      return await exportVersion(slug, n)
    } finally {
      exportsWriting--
    }
  })
  // a job like any other, so the updater waits for it (main/updater.ts counts running jobs)
  handle('projects:exportPlatforms', async (_e, slug: string, n: number, value: unknown) => {
    const request = parsePlatformExportRequest(value)
    const versions = await listVersions(projectDir(slug))
    if (![n, request.second?.version ?? n].every((m) => versions.some((v) => v.n === m))) throw { code: 'NO_VERSION', userMessage: 'Choose an available version before exporting for platforms.' }
    const version = await finishedExportVersion(slug, n)
    const project = await readProject(slug)
    const exportTry = (v: VersionInfo, platforms: Platform[], { caption, coverSeconds }: Pick<PlatformTry, 'caption' | 'coverSeconds'>): ExportTry => {
      const chosenCover = join(dirname(v.videoPath), 'cover.png')
      return { version: v.n, source: v.videoPath, chosenCover: existsSync(chosenCover) ? chosenCover : null,
        name: `${safeFileName(project.title || slug)} - Version ${v.n}`, platforms, caption, coverSeconds }
    }
    const first = exportTry(version, request.platforms, request)
    const { second } = request
    const secondVersion = second && (second.version === n ? version : await finishedExportVersion(slug, second.version))
    const tries: [ExportTry] | [ExportTry, ExportTry] = second && secondVersion
      ? [first, exportTry(secondVersion, secondTryPlatforms(request.platforms, second.version === n), second)]
      : [first]
    let result: PlatformExportResult | null = null
    let failure: unknown
    jobs.start(slug, 'export', async (emit, signal) => {
      emit({ type: 'status', message: 'Reading the finished video', pct: 1 })
      try {
        result = await exportPlatforms({
          tries, folder: binDir('exports'), runEngine, signal, onProgress: (message, pct) => emit({ type: 'status', message, pct })
        })
        return { summary: '', chat: [] }
      } catch (e) { failure = e; throw e }
    })
    await jobs.forSlug(slug)?.done
    if (failure) throw failure
    if (!result) throw { code: 'EXPORT_FAILED', userMessage: 'The export stopped. Try Export again.' }
    return result
  })
  handle('projects:coverCandidates', async (_e, slug: string, moments: number[], source: string): Promise<CoverCandidate[]> => {
    const at = moments.filter((t) => Number.isFinite(t) && t >= 0).slice(0, COVER_SUGGESTIONS)
    if (!at.length) return []
    const r = await coverScans.scan(slug, ['--project', projectDir(slug), '--at', at.join(','), '--source', source])
    return parseCoverCandidates(r, source, projectDir(slug))
  })
  handle('projects:stopCoverCandidates', (_e, slug: string) => coverScans.stop(slug))
  handle('projects:remove', async (_e, slug: string) => {
    await coverScans.stop(slug)
    await noteQueue.remove(slug, async () => {
      await fs.rm(noteStagingDir(projectDir(slug)), { recursive: true, force: true })
      await fs.rm(projectDir(slug), { recursive: true, force: true })
    })
  })

  handle('jobs:cancel', (_e, id: string, slug?: string) => noteQueue.stop(String(id), typeof slug === 'string' ? slug : undefined))
  handle('queue:edit', (_e, slug: string, id: string, text: string) => noteQueue.edit(slug, String(id), String(text ?? '')))
  handle('queue:cancel', (_e, slug: string, id: string) => noteQueue.cancel(slug, String(id)))
  handle('queue:move', (_e, slug: string, id: string, by: number) => noteQueue.move(slug, String(id), by < 0 ? -1 : 1))
  handle('queue:resume', (_e, slug: string) => noteQueue.resume(slug))
  handle('queue:clear', (_e, slug: string) => noteQueue.clear(slug))

  handle('library:list', async () => {
    await ensureRoot()
    return listLibrary()
  })
  handle('library:add', async (_e, paths: string[]) => {
    await ensureRoot()
    return addToLibrary(paths, runEngine, log)
  })
  handle('library:choose', async (_e, kind: 'music' | 'images') => {
    const filters =
      kind === 'music'
        ? [{ name: 'Songs', extensions: ['mp3', 'm4a', 'wav', 'aac', 'flac', 'ogg'] }]
        : [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'] }]
    const r = await showOpenDialog({
      title: kind === 'music' ? 'Pick a song' : 'Pick pictures',
      properties: ['openFile', 'multiSelections'],
      filters
    })
    if (r.canceled || !r.filePaths.length) return []
    await ensureRoot()
    return addToLibrary(r.filePaths, runEngine, log)
  })

  handle('style:rules', () => ai.styleRules())
  handle('style:remove', (_e, id: string) => ai.removeStyleRule(id))
  handle('style:damaged', async () => (await ai.styleWasDamaged?.()) ?? false)
  handle('style:update', (_e, id: string, patch: { text?: unknown; paused?: unknown }) => {
    if (!ai.updateStyleRule) throw { code: 'NOT_READY', userMessage: 'I could not change that in My style. Try again later.' }
    const text = typeof patch?.text === 'string' ? patch.text : undefined
    if (text !== undefined && !text.trim()) throw { code: 'EMPTY', userMessage: 'Type the rule first, or press Remove.' }
    return ai.updateStyleRule(id, { text, paused: typeof patch?.paused === 'boolean' ? patch.paused : undefined })
  })
  handle('style:answer', (_e, slug: string, messageId: string, yes: boolean) =>
    answerStyleQuestion(
      {
        chat: async (s) => (await readAppState(s)).chat,
        addStyleRule: ai.addStyleRule?.bind(ai),
        approveStyleProposal: ai.approveStyleProposal?.bind(ai),
        declineStyleProposal: ai.declineStyleProposal?.bind(ai),
        // one write: a crash can never leave the question without its buttons and without the reply
        settle: async (s, id, reply) => {
          await updateAppState(s, (st) => {
            const x = st.chat.find((y) => y.id === id)
            if (x) delete x.actions
            st.chat.push({ id: randomUUID(), from: 'editor', text: reply, at: new Date().toISOString() })
          })
        },
        serialized
      },
      slug,
      messageId,
      !!yes
    )
  )

  handle('update:state', () => updates.state())
  handle('update:check', () => updates.check('button'))
  handle('update:download', () => updates.download())
  handle('update:install', () => updates.install())
  handle('update:openRelease', (_e, version?: unknown) => updates.openRelease(version))
  handle('update:busy', updateBusy)
  handle('update:dismiss', (_e, version: unknown) => updates.dismiss(version))
  handle('update:setEnabled', (_e, on: unknown) => updates.setEnabled(on))

  handle('dev:renderTestAnimation', (_e, outPath: string, fullSize?: boolean, template?: string, params?: Record<string, unknown>) => {
    if (!TEST && app.isPackaged) throw { code: 'NOT_ALLOWED', userMessage: 'Not available.' }
    if (template) return host.renderAnimation(template, params ?? {}, outPath)
    return host.renderAnimation(TEST_TEMPLATE, { text: 'Hi', duration: fullSize ? 2 : 1 }, outPath)
  })
}

/** Old local-Claude-Code installs used Claude Code without a saved choice; keep it for them, once (ai-carryover.ts). */
async function carryOverClaudeCode(settings: { aiAutoPicked: boolean; aiCarriedOver: boolean }): Promise<void> {
  const decision = carryOverDecision({
    aiAutoPicked: settings.aiAutoPicked,
    carriedOver: settings.aiCarriedOver,
    choiceSaved: await aiChoiceSaved(join(settingsDir(), 'ai')),
    activeId: (await ai.active()).id,
    claudeCodeReady: settings.aiAutoPicked && !settings.aiCarriedOver ? (await ai.claudeCodeStatus?.())?.state === 'ready' : false
  })
  if (decision === 'nothing-to-do') {
    if (settings.aiAutoPicked && !settings.aiCarriedOver) await saveSettings({ aiCarriedOver: true })
    return
  }
  if (decision === 'not-ready-yet') return // try again next start: their Claude Code app may be signed out right now
  await ai.setActive('claude-cli')
  await saveSettings({ aiCarriedOver: true })
  log('[ai] kept Claude (your Claude Code app), which this install used before 0.1.2')
}

const permissionHelper = new MacPermissionHelper()
/** Test builds: the System Settings pages that would have opened. */
const paneLog: { opened: string[] } = { opened: [] }

async function openPane(pane: SettingsPane, help: { isGranted?: () => Promise<boolean>; onEnd?: () => void }): Promise<void> {
  const url = MAC_PANES[pane].url
  if (TEST) paneLog.opened.push(url)
  else await shell.openExternal(url)
  // A dev build runs as "Electron", which is the name System Settings lists; the helper would point at the wrong
  // row, so only the packaged app (and test builds, with no System Settings) shows it.
  if (!app.isPackaged && !TEST) return
  await permissionHelper
    .show(pane, {
      owner: win,
      preload: join(__dirname, '../preload/permission-helper.js'),
      icon: appIconPath(),
      instruction: helperInstruction(pane, rootDisplay(reelStudioRoot())),
      isGranted: help.isGranted,
      onEnd: help.onEnd,
      test: TEST
    })
    .catch((e) => log(`[permissions] helper: ${String(e)}`))
}

/** On macOS the first notification is what asks (Electron 44 requests authorization then). */
function showTestNotification(): Promise<NotifyResult> {
  if (TEST) return Promise.resolve('shown')
  return new Promise((resolve) => {
    const n = new Notification({ title: 'Notifications are on', body: "I'll tell you here when a video is ready.", silent: true })
    // The macOS question is still on screen: the checklist offers "Ask again".
    const t = setTimeout(() => resolve('pending'), 20_000)
    n.once('show', () => {
      clearTimeout(t)
      resolve('shown')
    })
    n.once('failed', (_e, error) => {
      clearTimeout(t)
      log(`[notify] ${error}`)
      resolve('failed')
    })
    n.show()
  })
}

// ---- window -------------------------------------------------------------------------------------
function createWindow(): void {
  win = createMainWindow({ preload: join(__dirname, '../preload/index.js'), stateFile: windowStateFile(settingsDir()), test: TEST })
  installMenu(sendCommand, DEV_PROVIDERS || !app.isPackaged, () =>
    // On Mac the menu outlives a closed window, so the window may be gone when this runs.
    void menuCheckForUpdates(updates, {
      focus: () => {
        if (!win || win.isDestroyed()) createWindow()
        win?.show()
      },
      show: (o) => (win && !win.isDestroyed() ? dialog.showMessageBox(win, o) : dialog.showMessageBox(o))
    }).catch((e) => log(`[update] menu check failed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`))
  )
  win.once('ready-to-show', () => win?.show())
  // Stop flashing the taskbar once the person is back.
  win.on('focus', () => win?.flashFrame(false))
  // The animation renderer keeps a hidden offscreen window; it must not keep the app alive.
  win.on('closed', () => void closeAnimationRenderer())
  // Links open in the system browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // The app is one page: it never navigates (review 30). Links go out through the handler above.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/** `--self-test [--out <file>]`: check the bundled python, ffmpeg and engine, write JSON, exit 0 (passed) or 1. */
async function selfTestAndQuit(): Promise<void> {
  app.dock?.hide()
  const t0 = Date.now()
  const userData = app.getPath('userData')
  const out = SELF_TEST.out ?? join(userData, 'selftest-result.json')
  const locations = { python: pythonExe(), ffmpeg: ffmpegPath(), ffprobe: ffprobePath(), engine: engineDir() }
  // The engine's encoder probe and caches would otherwise land in the person's Application Support / Caches.
  const isolated = join(userData, 'engine cache')
  const run = createEngineRunner({
    python: pythonExe,
    env: () => ({ ...engineEnv(), REELENGINE_CACHE: isolated, REELENGINE_CACHE_DIR: isolated, HF_HOME: join(userData, 'hf-cache') }),
    cwd: engineDir,
    log
  })
  let outcome: { ok: boolean; result?: SelfTestResult; error?: string }
  try {
    const result = await runSelfTest({
      locations,
      runEngine: run
    })
    outcome = { ok: result.ok, result }
  } catch (e) {
    outcome = { ok: false, error: e instanceof Error ? e.stack ?? e.message : String(e) }
  } finally {
    await killAllEngines()
  }
  const payload = {
    ...outcome,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    electron: process.versions.electron,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    userData,
    locations
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(payload, null, 2))
  app.exit(payload.ok ? 0 : 1)
}

const pendingOpenFiles: string[] = []
let setupDone = false
function queueOpenFiles(files: string[]): void {
  pendingOpenFiles.push(...files)
  // Early open-file events must wait until IPC and the app's services are ready.
  if (!setupDone) return
  if (!win || win.isDestroyed()) {
    createWindow() // The new renderer drains pendingOpenFiles on mount.
  } else {
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send('app:filesAvailable')
  }
}
app.on('open-file', (event, path) => {
  event.preventDefault()
  queueOpenFiles([path])
})
if (process.platform === 'win32') queueOpenFiles(filesFromArgv(process.argv, process.cwd(), !!process.defaultApp))

const gotLock = TEST || SELF_TEST.selfTest || app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', (_event, argv, cwd) => {
  queueOpenFiles(filesFromArgv(argv, cwd, !!process.defaultApp))
  // The window is destroyed but the app still running when it was closed on macOS, or when closing it on Windows
  // or Linux started a quit that is waiting for a drive save. A null window means startup has not opened it yet.
  if (win?.isDestroyed()) return createWindow()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && process.execPath.startsWith('/Volumes/')) {
    log('[start] executable is under /Volumes/ on macOS; running from a mounted volume that may be a read-only disk image')
  }
  if (process.platform === 'darwin' && process.execPath.includes('/AppTranslocation/')) {
    log('[start] executable is under /AppTranslocation/ on macOS; running from a read-only Gatekeeper translocated copy')
  }
  if (SELF_TEST.selfTest) return selfTestAndQuit()
  if (gotLock) {
    const move = await offerMoveToApplications(
      {
        platform: process.platform,
        isPackaged: app.isPackaged,
        test: TEST,
        inApplications: process.platform === 'darwin' && app.isInApplicationsFolder(),
        exePath: process.execPath,
        writeError: writeErrorCode
      },
      {
        destinationExists: (path) => existsSync(path),
        ask: async (q) => (await dialog.showMessageBox(q)).response,
        askNow: (q) => dialog.showMessageBoxSync(q),
        move: (options) => app.moveToApplicationsFolder(options),
        log
      }
    )
    if (move === 'moving') return // this copy quits; the one in Applications opens
  }
  pidRegistry = createPidRegistry(settingsDir())
  // an engine that would not stop may be encoding: only its own video waits for it, the others render
  const settings = await settleLastRun(pidRegistry, (slug) => jobs.keepClosed(slug), log, (slug) => jobs.reopen(slug))
  notificationsOn = notificationsWanted(settings, process.platform)
  perms = createPermissions({
    platform: process.platform,
    root: reelStudioRoot,
    rootDisplay: () => rootDisplay(reelStudioRoot()),
    touched: settings.firstRunDone,
    ensureRoot,
    load: loadSettings,
    save: saveSettings,
    notificationsSupported: () => Notification.isSupported(),
    showTestNotification,
    openPane,
    fakes: TEST ? parseFakes(process.env.REELSTUDIO_TEST_PERMISSIONS) : undefined
  })
  if (TEST) Object.assign(globalThis, { __reelPermFakes: perms.fakes, __reelPermLog: paneLog })
  // reading the queues and the exports folder reads the Reel Studio folder, which a first run has not made yet
  if (settings.firstRunDone) {
    await noteQueue.recover().catch((e) => log(`[queue] ${String(e)}`))
    await sweepExportStaging(binDir('exports')).catch((e) => log(`[export] ${String(e)}`))
  }
  const loaded = await loadAI(
    {
      host,
      settingsDir: join(settingsDir(), 'ai'),
      dev: DEV_PROVIDERS,
      secretStore: safeStorage
    },
    log
  )
  ai = loaded.ai
  aiSource = loaded.source
  await carryOverClaudeCode(settings).catch((e) => log(`[ai] carry-over: ${String(e)}`))
  log(`[start] root=${reelStudioRoot()} engine=${engineMode()}:${engineDir()} python=${pythonExe()} ai=${aiSource}`)
  handleMediaProtocol(() => [reelStudioRoot(), projectsDir(), noteStagingRoot()])
  setAsrThreads(await models.savedThreads()) // before any engine call can start
  registerIpc()
  setupDone = true
  createWindow()
  await updates.init()
  updates.start() // 15 s after the window, so launch is never slower
  // A model that was here before the timing check existed, or whose check a video interrupted, so it never slows launch.
  if (!TEST) setTimeout(() => void models.checkInBackground(), 30_000)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on('before-quit', (e) => {
  void stopPhoneShare() // the "Send to my phone" link never outlives the app
  permissionHelper.close()
  if (quitting || (!jobs.runningCount() && !cloudSavesRunning())) {
    void killAllEngines()
    return
  }
  // Stop running work cleanly so the next start finds a tidy project, and give drive saves time to finish so
  // the synced folder is not left with a temporary file. Both waits are capped (jobs.ts, phone-ipc.ts).
  e.preventDefault()
  quitting = true
  noteQueue.quit()
  void Promise.allSettled([jobs.cancelAll().then(() => killAllEngines()), cloudSavesSettled()]).finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export { readAppState }
