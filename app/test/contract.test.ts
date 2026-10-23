// The read contract (shared/contract.ts + main/service.ts): what a page may ask, and that what it gets back names
// no place on this computer. A browser page is a less trusted client than the desktop window, so both matter.
import { describe, expect, it } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkArgs, METHODS } from '../src/shared/contract'
import { createService } from '../src/main/service'
import { createJobManager } from '../src/main/jobs'
import { createMockAI } from '../src/main/ai-mock'
import { parseRange, resolveMediaRef } from '../src/main/media-files'
import { setupPaths } from './helpers'

function service() {
  const ai = createMockAI({ host: {} as never, settingsDir: '', dev: false, secretStore: null as never })
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

  it('covers the reads the renderer needs and nothing that changes state', () => {
    expect(Object.keys(METHODS).sort()).toEqual(
      ['ai.active', 'ai.claudeCodeStatus', 'ai.providers', 'app.info', 'model.status', 'projects.get', 'projects.list', 'style.rules', 'update.status']
    )
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

describe('media refs: only media inside Projects/ or Library/', () => {
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
