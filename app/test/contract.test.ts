// The read contract (shared/contract.ts + main/service.ts): what a page may ask, and that what it gets back names
// no place on this computer. A browser page is a less trusted client than the desktop window, so both matter.
import { describe, expect, it } from 'vitest'
import { closeSync, mkdirSync, readSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkArgs, METHODS, NOTE_MAX_CHARS } from '../src/shared/contract'
import { createService } from '../src/main/service'
import { createJobManager } from '../src/main/jobs'
import { createMockAI } from '../src/main/ai-mock'
import { openMediaRef, parseRange, resolveMediaRef } from '../src/main/media-files'
import { clientProject } from '../src/main/store'
import type { AI } from '../src/main/ai-types'
import type { ProjectJson } from '../src/shared/api'
import { reelStudioRoot } from '../src/main/paths'
import { setupPaths } from './helpers'

function service(over: Partial<AI> = {}) {
  const nothing = () => Promise.reject(new Error('the read contract runs nothing'))
  const ai = { ...createMockAI({ host: { runEngine: nothing, renderAnimation: nothing, reelStudioRoot }, settingsDir: '' }), ...over }
  return createService({
    info: async () => ({ version: 't', platform: 'test', firstRunDone: true, engine: { mode: 'fake' }, ai: 'mock', test: true, dev: false }),
    ai: () => ai,
    jobs: createJobManager(() => undefined, () => undefined),
    models: { status: () => ({ name: 'm', installed: true, downloading: false, pct: 100, bytes: 0, total: 0, error: null }) },
    updates: { status: async () => ({ enabled: false, notice: null }) }
  })
}

/** A project the way the engine and the app leave it, with every kind of file the page is shown. */
function realisticProject(root: string, slug: string): void {
  const dir = join(root, 'Projects', slug)
  for (const d of ['media', 'work/thumbs', 'versions/v1', 'versions/v2']) mkdirSync(join(dir, d), { recursive: true })
  mkdirSync(join(root, 'Library', 'Images'), { recursive: true })
  writeFileSync(join(dir, 'media', 'take01.mp4'), 'raw')
  writeFileSync(join(root, 'Library', 'Images', 'logo.png'), 'png')
  for (const v of ['v1', 'v2']) {
    writeFileSync(join(dir, 'versions', v, 'export.mp4'), 'mp4')
    writeFileSync(join(dir, 'versions', v, 'cover.png'), 'png')
  }
  const now = new Date().toISOString()
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({
      schemaVersion: 1, id: slug, title: 'Morning tips', slug, createdAt: now, updatedAt: now, version: 2,
      sources: [{ id: 's1', path: 'media/take01.mp4', duration: 12, mirror: true }],
      transcript: { file: 'work/transcript.json' },
      cut: { keep: [] },
      // an absolute path inside the root, as older builds wrote it
      broll: [{ id: 'b1', anchor: { from: 'w0', to: 'w1' }, treatment: 'card-above-head', asset: join(root, 'Library', 'Images', 'logo.png') }],
      music: { enabled: true, track: join(root, 'Library', 'Music', 'song.mp3') }
    })
  )
  writeFileSync(join(dir, 'work', 'transcript.json'), JSON.stringify({ words: [] }))
}

describe('contract arguments', () => {
  it('refuses unknown calls and arguments of the wrong shape before anything runs', () => {
    expect(() => checkArgs('projects.remove', ['a'])).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    expect(() => checkArgs('toString', [])).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    expect(() => checkArgs('projects.get', [])).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    expect(() => checkArgs('projects.get', ['a', 'b'])).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    expect(() => checkArgs('projects.list', 'x')).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    for (const bad of ['../etc', '..', '.hidden', 'a/b', 'a\\b', '', 42, null, { slug: 'a' }, 'x'.repeat(201)]) {
      expect(() => checkArgs('projects.get', [bad])).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    }
    expect(checkArgs('projects.get', ['my-réel_2.v'])).toEqual(['my-réel_2.v'])
  })

  it('covers the reads the renderer needs, and only two commands: a note and Stop', () => {
    expect(Object.keys(METHODS).sort()).toEqual(
      ['ai.active', 'ai.claudeCodeStatus', 'ai.providers', 'app.info', 'jobs.cancel', 'model.status', 'projects.get', 'projects.list', 'projects.note', 'style.rules', 'update.status']
    )
  })

  it('bounds a note and a job id', () => {
    expect(checkArgs('projects.note', ['a', 'bigger subtitles'])).toEqual(['a', 'bigger subtitles', undefined, undefined])
    expect(checkArgs('projects.note', ['a', '', ['work/assets/attach-1.png']])).toEqual(['a', '', ['work/assets/attach-1.png'], undefined])
    expect(checkArgs('projects.note', ['a', 'x', null, 'f3b1c2d4-0000-4000-8000-000000000001'])).toEqual(['a', 'x', undefined, 'f3b1c2d4-0000-4000-8000-000000000001'])
    for (const bad of [['a'], ['a', 5], ['a', 'x'.repeat(NOTE_MAX_CHARS + 1)], ['a', 'x', 'work/assets/a.png'], ['a', 'x', [1]], ['a', 'x', Array(9).fill('r')], ['../a', 'x'], ['a', 'x', null, 'short'], ['a', 'x', null, 'has space in it'], ['a', 'x', null, 'id', 'extra']]) {
      expect(() => checkArgs('projects.note', bad), JSON.stringify(bad).slice(0, 60)).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
    }
    expect(checkArgs('jobs.cancel', ['0b8f2c1e-9d4a-4f7e-8a3b-1c2d3e4f5a6b'])).toHaveLength(1)
    for (const bad of [[], [''], ['a b'], [{}], ['x'.repeat(65)]]) expect(() => checkArgs('jobs.cancel', bad)).toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }))
  })

  it('a bad slug never reaches the disk', async () => {
    setupPaths()
    await expect(service().dispatch('projects.get', ['../../secrets'])).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})

describe('contract results name no place on this computer', () => {
  it('projects.list and projects.get carry media refs and no absolute path', async () => {
    const { root } = setupPaths()
    realisticProject(root, 'morning')
    const s = service()
    const list = await s.dispatch('projects.list', [])
    const detail = (await s.dispatch('projects.get', ['morning'])) as Awaited<ReturnType<typeof import('../src/main/store').detail>>
    const info = await s.dispatch('app.info', [])
    for (const out of [list, detail, info]) {
      const json = JSON.stringify(out)
      expect(json).not.toContain(root)
      expect(json).not.toContain(encodeURIComponent(root))
      expect(json).not.toContain(root.split('/').map(encodeURIComponent).join('/'))
    }
    expect(detail.versions.map((v) => v.video)).toEqual([
      expect.stringMatching(/^Projects\/morning\/versions\/v1\/export\.mp4\?v=\d+$/),
      expect.stringMatching(/^Projects\/morning\/versions\/v2\/export\.mp4\?v=\d+$/)
    ])
    expect(detail.sourceVideo).toBe('Projects/morning/media/take01.mp4')
    expect(detail.project.sources).toEqual([{ id: 's1', duration: 12, mirror: true }])
    expect(detail.project.broll?.[0].asset).toBe('Library/Images/logo.png')
    expect(detail.project.music?.track).toBe('Library/Music/song.mp3')
    expect(detail.brollThumbs).toEqual({ b1: 'Library/Images/logo.png' })
    // and every ref resolves to the file it names
    const v2 = resolveMediaRef(detail.versions[1].video)
    expect(v2).toMatchObject({ ok: true, type: 'video/mp4', size: 3 })
  })
})

describe('contract results name no place on this computer, even for fields nobody listed', () => {
  it('clientProject keeps only the schema\'s fields, at every level', () => {
    const { root, home } = setupPaths()
    mkdirSync(join(root, 'Library', 'Images'), { recursive: true })
    writeFileSync(join(home, 'font.ttf'), 'x')
    const leaky = {
      schemaVersion: 1, id: 'p', title: 'T', slug: 'p', createdAt: '', updatedAt: '', version: 1,
      localPath: `${home}/x`,
      sources: [{ id: 's1', path: 'media/take01.mp4', originalPath: `${home}/Desktop/take.mov`, originalName: 'take.mov', duration: 3 }],
      transcript: { file: `${home}/t.json` },
      music: { enabled: true, track: 'Library/Music/a.mp3', localPath: `${home}/a.mp3`, automation: [{ fromWord: 'w1', toWord: 'w2', gainDb: -6, file: `${home}/x` }] },
      broll: [{ id: 'b1', anchor: { from: 'w1', to: 'w2', path: `${home}/x` }, treatment: 'card', asset: 'Library/Images/a.png', path: `${home}/b.png`, params: { text: '/r/videos', image: join(home, 'font.ttf') } }],
      captions: { enabled: true, style: { size: 90, font: join(home, 'font.ttf'), fontFile: `${home}/f.ttf` }, corrections: [{ from: 'a', to: 'b', source: `${home}/x` }] },
      cut: { keep: [{ from: 'w1', to: 'w2', file: `${home}/x` }], cache: `${home}/x` },
      zooms: [{ anchor: { from: 'w1', to: 'w2' }, scale: 1.2, cache: `${home}/x` }],
      cover: { atSourceTime: 1, source: 's1', text: null, file: `${home}/c.png` },
      post: { caption: 'hi', hashtags: [], keywords: [], draft: `${home}/x` },
      notes: [{ version: 1, text: 'n', applied: [], at: '', attachments: ['work/assets/attach-1.png'], file: `${home}/x` }]
    } as unknown as ProjectJson
    const out = clientProject(leaky)
    expect(JSON.stringify(out)).not.toContain(home)
    expect(out.sources).toEqual([{ id: 's1', originalName: 'take.mov', duration: 3 }])
    expect(out.broll?.[0]).toEqual({ id: 'b1', anchor: { from: 'w1', to: 'w2' }, treatment: 'card', asset: 'Library/Images/a.png', params: { text: '/r/videos' } })
    expect(out.captions?.style).toEqual({ size: 90 })
    expect(out.music).toEqual({ enabled: true, track: 'Library/Music/a.mp3', automation: [{ fromWord: 'w1', toWord: 'w2', gainDb: -6 }] })
  })

  it('a browser gets provider status without detail (an account email, a dev fixture\'s path)', async () => {
    setupPaths()
    const replay = { id: 'replay' as const, connected: true, label: 'Replay', detail: '/Users/someone/fixtures/run.json' }
    const s = service({ providers: async () => [replay], active: async () => replay })
    expect(await s.dispatch('ai.providers', [], { browser: true })).toEqual([{ id: 'replay', connected: true, label: 'Replay' }])
    expect(await s.dispatch('ai.active', [], { browser: true })).toEqual({ id: 'replay', connected: true, label: 'Replay' })
    expect(await s.dispatch('ai.active', [])).toEqual(replay) // the desktop window still shows it
  })
})

describe('media refs: only media inside Projects/ or Library/', () => {
  it('streams the file it checked, even if the folder changes while it is being opened', () => {
    const { root, home } = setupPaths()
    realisticProject(root, 'p')
    writeFileSync(join(home, 'secret.mp4'), 'secret')
    const take = join(root, 'Projects', 'p', 'media', 'take01.mp4')
    const ref = 'Projects/p/media/take01.mp4'
    const swap = () => {
      renameSync(take, `${take}.old`)
      symlinkSync(join(home, 'secret.mp4'), take)
    }
    const unswap = () => {
      renameSync(take, `${take}.link`)
      renameSync(`${take}.old`, take)
    }
    // swapped for a symlink out of the root right after the open: the open file is no longer what the path is
    expect(openMediaRef(ref, swap)).toEqual({ ok: false, status: 403 })
    unswap()
    // pointing out of the root while it is opened, and back inside before the checks: only the open file counts
    swap()
    expect(openMediaRef(ref, unswap)).toEqual({ ok: false, status: 403 })
    // swapped after the checks: the stream reads the checked descriptor, never the path again
    const opened = openMediaRef(ref)
    if (!opened.ok) throw new Error('not opened')
    renameSync(take, `${take}.old2`)
    symlinkSync(join(home, 'secret.mp4'), take)
    const buf = Buffer.alloc(16)
    const n = readSync(opened.fd, buf, 0, 16, 0)
    closeSync(opened.fd)
    expect(buf.subarray(0, n).toString()).toBe('raw')
  })


  it('serves a real file and refuses anything that leaves the folders', () => {
    const { root, home } = setupPaths()
    realisticProject(root, 'p')
    writeFileSync(join(home, 'secret.mp4'), 'secret')
    writeFileSync(join(root, 'My style.json'), '{}')
    writeFileSync(join(root, 'Projects', 'p', 'project.mp4.json'), '{}')
    symlinkSync(join(home, 'secret.mp4'), join(root, 'Projects', 'p', 'media', 'escape.mp4'))
    symlinkSync(home, join(root, 'Projects', 'p', 'outside'))

    expect(resolveMediaRef('Projects/p/media/take01.mp4')).toMatchObject({ ok: true, size: 3 })
    expect(resolveMediaRef('Projects/p/media/take01.mp4?v=12')).toMatchObject({ ok: true })
    // the shape: traversal, encoded separators, absolute paths, other top folders
    for (const bad of ['Projects/../../secret.mp4', 'Projects/%2e%2e/%2e%2e/secret.mp4', 'Projects/p%2F..%2F..%2Fsecret.mp4', `${home}/secret.mp4`, 'Settings/x.mp4', 'Projects', 'Projects//p/media/take01.mp4', 'Projects/%E0%A4%A/x.mp4']) {
      expect(resolveMediaRef(bad), bad).toMatchObject({ ok: false, status: 400 })
    }
    // symlinks out of the root, found only on disk
    expect(resolveMediaRef('Projects/p/media/escape.mp4')).toMatchObject({ ok: false, status: 403 })
    expect(resolveMediaRef('Projects/p/outside/secret.mp4')).toMatchObject({ ok: false, status: 403 })
    // not media, or not there
    expect(resolveMediaRef('Projects/p/project.json')).toMatchObject({ ok: false, status: 404 })
    expect(resolveMediaRef('Projects/p/project.mp4.json')).toMatchObject({ ok: false, status: 404 })
    expect(resolveMediaRef('Projects/p/media/none.mp4')).toMatchObject({ ok: false, status: 404 })
    expect(resolveMediaRef('Projects/p/media')).toMatchObject({ ok: false, status: 404 })
  })

  it('parses one byte range the way <video> seeks', () => {
    expect(parseRange(undefined, 100)).toBeNull()
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=-500', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseRange('bytes=99999999999999999999-', 100)).toBe('unsatisfiable')
    // not one plain range: send the whole file
    expect(parseRange('bytes=5-1', 100)).toBeNull()
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
  })
})
