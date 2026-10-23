// The only bridge between the page and the main process. The page never sees Node or ipcRenderer.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppCommand, JobEvent, ModelStatus, PhoneEvent, ProviderInfo, ReelApi } from '../shared/api'
import type { UpdateState } from '../shared/update'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as
    | { ok: true; value: T }
    | { ok: false; error: { code: string; userMessage: string } }
  if (r.ok) return r.value
  throw r.error
}

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const fn = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(channel, fn)
  return () => ipcRenderer.removeListener(channel, fn)
}

const api: ReelApi = {
  app: {
    info: () => call('app:info'),
    clipboardFiles: () => call('app:clipboardFiles'),
    takeOpenFiles: () => call('app:takeOpenFiles'),
    onFilesAvailable: (cb) => on('app:filesAvailable', cb),
    finishFirstRun: () => call('app:finishFirstRun'),
    openFolder: (p) => call('app:openFolder', p),
    copyText: (t) => call('app:copyText', t),
    dimTitleBar: (on) => call('app:dimTitleBar', on),
    pathForFile: (f) => webUtils.getPathForFile(f),
    chooseFolder: () => call('app:chooseFolder'),
    setRoot: (p) => call('app:setRoot', p),
    setFasterExports: (on) => call('app:setFasterExports', on),
    setModels: (models) => call('app:setModels', models),
    setSharing: (sharing) => call('app:setSharing', sharing),
    setPhoneView: (view) => call('app:setPhoneView', view),
    setSoundEffects: (on) => call('app:setSoundEffects', on),
    onCommand: (cb) => on<AppCommand>('app:command', cb),
    startDrag: (file) => ipcRenderer.send('app:startDrag', file),
    legal: (doc) => call('app:legal', doc),
    showLegal: (doc) => call('app:showLegal', doc)
  },
  model: {
    status: () => call('model:status'),
    download: () => call('model:download'),
    find: () => call('model:find'),
    cancel: () => call('model:cancel'),
    onProgress: (cb) => on<ModelStatus>('model:progress', cb)
  },
  ai: {
    providers: () => call('ai:providers'),
    active: () => call('ai:active'),
    setActive: (id, connectionId) => call('ai:setActive', id, connectionId),
    signInChatGPT: () => call('ai:signInChatGPT'),
    cancelSignIn: () => call('ai:cancelSignIn'),
    cancelCheck: () => call('ai:cancelCheck'),
    signOutChatGPT: () => call('ai:signOutChatGPT'),
    setClaudeKey: (k) => call('ai:setClaudeKey', k),
    claudeCodeStatus: () => call('ai:claudeCodeStatus'),
    openClaudeSignIn: () => call('ai:openClaudeSignIn'),
    checkEdits: () => call('ai:checkEdits'),
    setCheckEdits: (on) => call('ai:setCheckEdits', on),
    connections: () => call('ai:connections'),
    saveConnection: (input) => call('ai:saveConnection', input),
    removeConnection: (id) => call('ai:removeConnection', id),
    setConnectionImages: (id, on) => call('ai:setConnectionImages', id, on),
    connectionModels: (q) => call('ai:connectionModels', q),
    onChange: (cb) => on<ProviderInfo>('ai:change', cb)
  },
  projects: {
    list: () => call('projects:list'),
    search: (query) => call('projects:search', query),
    get: (slug) => call('projects:get', slug),
    create: (files) => call('projects:create', files),
    plan: () => call('projects:plan'),
    leave: (slug) => call('projects:leave', slug),
    addVideo: (slug, files) => call('projects:addVideo', slug, files),
    script: (slug, idea) => call('projects:script', slug, idea),
    resume: (slug, basic) => call('projects:resume', slug, basic),
    note: (slug, text, attachments, moment, onVersion, base) => call('projects:note', slug, text, attachments, moment, onVersion, base),
    mergeVersions: (slug, request) => call('projects:mergeVersions', slug, request),
    timeline: (slug, n) => call('projects:timeline', slug, n),
    versionRows: (slug, n) => call('projects:versionRows', slug, n),
    update: (slug, patch) => call('projects:update', slug, patch),
    handEdit: (slug, edit, summary, changes, replace) => call('projects:handEdit', slug, edit, summary, changes, replace),
    exportVersion: (slug, n) => call('projects:export', slug, n),
    coverCandidates: (slug, moments, source) => call('projects:coverCandidates', slug, moments, source),
    stopCoverCandidates: (slug) => call('projects:stopCoverCandidates', slug),
    exportPlatforms: (slug, n, request) => call('projects:exportPlatforms', slug, n, request),
    remove: (slug) => call('projects:remove', slug)
  },
  notes: {
    attachFiles: (slug, paths) => call('notes:attachFiles', slug, paths),
    attachData: (slug, file) => call('notes:attachData', slug, file),
    attachClipboard: (slug) => call('notes:attachClipboard', slug),
    choose: (slug) => call('notes:chooseAttachment', slug),
    remove: (slug, asset) => call('notes:removeAttachment', slug, asset)
  },
  jobs: {
    cancel: (id, slug) => call('jobs:cancel', id, slug),
    onEvent: (cb) => on<JobEvent>('job:event', cb)
  },
  queue: {
    edit: (slug, id, text) => call('queue:edit', slug, id, text),
    cancel: (slug, id) => call('queue:cancel', slug, id),
    move: (slug, id, by) => call('queue:move', slug, id, by),
    runNext: (slug) => call('queue:runNext', slug),
    clear: (slug) => call('queue:clear', slug),
    onChange: (cb) => on<string>('queue:change', cb)
  },
  cloud: {
    drives: () => call('cloud:drives'),
    save: (video, folder, id) => call('cloud:save', video, folder, id),
    cancel: (id) => call('cloud:cancel', id),
    onProgress: (cb) => on<{ id: string; pct: number }>('cloud:progress', cb)
  },
  phone: {
    start: (video, caption, address) => call('phone:start', video, caption, address),
    stop: () => call('phone:stop'),
    onEvent: (cb) => on<PhoneEvent>('phone:event', cb),
    emailSelf: (video) => call('phone:emailSelf', video),
    shareSheet: (video) => call('phone:shareSheet', video)
  },
  library: {
    list: () => call('library:list'),
    add: (paths) => call('library:add', paths),
    choose: (kind) => call('library:choose', kind),
    preview: (path) => call('library:preview', path)
  },
  style: {
    rules: () => call('style:rules'),
    add: (text) => call('style:add', text),
    remove: (id) => call('style:remove', id),
    damaged: () => call('style:damaged'),
    restore: (id) => call('style:restore', id),
    learn: () => call('style:learn'),
    keepLearned: (rules, from) => call('style:keepLearned', rules, from),
    update: (id, patch) => call('style:update', id, patch),
    answer: (slug, messageId, yes) => call('style:answer', slug, messageId, yes),
    rememberLowercase: (slug) => call('style:rememberLowercase', slug)
  },
  sfx: {
    pack: () => call('sfx:pack')
  },
  dev: {
    renderTestAnimation: (out, full, template, params) => call('dev:renderTestAnimation', out, full, template, params)
  },
  perm: {
    status: () => call('perm:status'),
    allowFolder: () => call('perm:allowFolder'),
    setNotifications: (on) => call('perm:setNotifications', on),
    openSettings: (pane) => call('perm:openSettings', pane)
  },
  update: {
    state: () => call('update:state'),
    onState: (cb) => on<UpdateState>('update:state', cb),
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    openRelease: (version) => call('update:openRelease', version),
    busy: () => call('update:busy'),
    dismiss: (version) => call('update:dismiss', version),
    setEnabled: (on) => call('update:setEnabled', on)
  }
}

contextBridge.exposeInMainWorld('reel', api)
