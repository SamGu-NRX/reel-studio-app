// The browser's one editing job, end to end in Node: a note sent over the server's WebSocket becomes a new version,
// with progress events on the way, through the real service, job manager, stand-in AI and stand-in engine. The new
// version then plays over HTTP. Only Electron is left out (e2e/browser.spec.ts drives the real app).
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type WebSocket from 'ws'
import type { JobEvent, ProjectDetail } from '../src/shared/api'
import { http, pairDevice, signIn } from './browser-client'
import { createMockAI } from '../src/main/ai-mock'
import type { EngineHost } from '../src/main/ai-types'
import { createEngineRunner, type RunEngine } from '../src/main/engine'
import { createJobManager } from '../src/main/jobs'
import { createLiveVideos } from '../src/main/live-video'
import { engineEnv, reelStudioRoot } from '../src/main/paths'
import { createService } from '../src/main/service'
import { startBrowserServer, type BrowserServer } from '../src/main/server'
import { projectDir } from '../src/main/store'
import { FAKE_ENGINE, makeClip, PYTHON, setupPaths } from './helpers'

/** The stand-in AI with its stand-in "Claude Code app" signed in (REELSTUDIO_MOCK_CLAUDE=ready). */
function createAI(runEngine: RunEngine) {
  const was = process.env.REELSTUDIO_MOCK_CLAUDE
  process.env.REELSTUDIO_MOCK_CLAUDE = 'ready'
  try {
    const host: EngineHost = { runEngine, reelStudioRoot, renderAnimation: () => Promise.reject(new Error('no animations in this test')) }
    return createMockAI({ host, settingsDir: '' })
  } finally {
    if (was === undefined) delete process.env.REELSTUDIO_MOCK_CLAUDE
    else process.env.REELSTUDIO_MOCK_CLAUDE = was
  }
}

let server: BrowserServer | null = null
let ws: WebSocket | null = null
afterEach(async () => {
  ws?.terminate()
  await server?.close()
  server = null
})

describe('a note sent from the browser', () => {
  it('makes a new version with the stand-in AI and engine, and the page watches it happen', async () => {
    const { home } = setupPaths()
    const runEngine = createEngineRunner({ python: () => PYTHON, env: () => ({ ...engineEnv(), PYTHONPATH: FAKE_ENGINE }) })
    // a reel with Version 1, the way the first edit leaves it
    const slug = 'morning'
    const dir = projectDir(slug)
    mkdirSync(dir, { recursive: true })
    await runEngine('init', ['--project', dir, '--title', 'Morning', '--slug', slug, makeClip(join(home, 'take.mp4'))])
    await runEngine('render', ['--project', dir])

    const ai = createAI(runEngine)
    await ai.setActive('claude-cli') // the stand-in "Claude Code app" (REELSTUDIO_MOCK_CLAUDE=ready): a connected editor
    const live = createLiveVideos()
    const jobs = createJobManager(
      (e) => server?.publish('job', e),
      () => undefined,
      undefined,
      (s, e) => live(projectDir(s), e)
    )
    const service = createService({
      info: async () => ({ version: 't', platform: 'test', firstRunDone: true, engine: { mode: 'fake' }, ai: 'mock', test: true, dev: false }),
      ai: () => ai,
      jobs,
      models: { status: () => ({ name: 'm', installed: true, downloading: false, pct: 100, bytes: 0, total: 0, error: null }) },
      updates: { status: async () => ({ enabled: false, notice: null }) }
    })
    server = await startBrowserServer({ service, rendererDir: null, log: () => undefined })
    const s = server
    const signed = await signIn(s, await pairDevice(s))
    if (!('ws' in signed)) throw new Error(`not signed in: ${JSON.stringify(signed)}`)
    ws = signed.ws
    const events: JobEvent[] = []
    const replies = new Map<number, (m: { ok: boolean; value?: any; error?: unknown }) => void>()
    const ended: (() => void)[] = []
    const done = new Promise<void>((r) => ended.push(r))
    const done2 = new Promise<void>((r) => ended.push(r))
    ws.on('message', (data) => {
      const m = JSON.parse(String(data))
      if (m.event === 'job') {
        events.push(m.payload)
        if (['done', 'error', 'cancelled'].includes(m.payload.type)) ended.shift()?.()
      } else replies.get(m.id)?.(m)
    })
    let id = 0
    const call = (method: string, ...args: unknown[]) =>
      new Promise<any>((resolve, reject) => {
        replies.set(++id, (m) => (m.ok ? resolve(m.value) : reject(m.error)))
        ws!.send(JSON.stringify({ id, method, args }))
      })

    const before: ProjectDetail = await call('projects.get', slug)
    expect(before.versions.map((v) => v.n)).toEqual([1])

    const { jobId } = await call('projects.note', slug, 'Make the subtitles bigger')
    expect(jobId).toEqual(expect.any(String))
    await done

    const mine = events.filter((e) => e.jobId === jobId)
    expect(mine.at(-1)).toMatchObject({ type: 'done', version: 2 })
    // live progress: status lines with a whole-job percent, then the new version's render
    expect(mine.filter((e) => e.type === 'status').length).toBeGreaterThan(1)
    expect(mine.some((e) => e.type === 'status' && e.message === 'Putting it all together')).toBe(true)
    const render = mine.find((e) => e.type === 'render')
    expect(render).toMatchObject({ version: 2, draft: false, video: expect.stringMatching(/^Projects\/morning\/versions\/v2\/export\.mp4\?v=\d+$/) })

    const after: ProjectDetail = await call('projects.get', slug)
    expect(after.versions.map((v) => v.n)).toEqual([1, 2])
    expect(after.chat.map((m) => [m.from, m.text])).toEqual([
      ['you', 'Make the subtitles bigger'],
      ['editor', expect.stringContaining('Version 2')]
    ])
    expect(after.project.notes?.map((n) => n.text)).toEqual(['Make the subtitles bigger'])

    // and the browser can seek in it
    const v2 = after.versions[1].video
    const part = await http(s, `/media/${signed.mediaToken}/${v2}`, { headers: { Range: 'bytes=1000-1999' } })
    expect(part.status).toBe(206)
    expect(part.body.length).toBe(1000)
    expect(part.headers['content-range']).toMatch(/^bytes 1000-1999\/\d+$/)

    // the same request id again (a page that lost the answer and retried) is answered, not run again
    const again = await call('projects.note', slug, 'Make it louder', undefined, 'retry-0001')
    await done2
    expect(await call('projects.note', slug, 'Make it louder', undefined, 'retry-0001')).toEqual(again)
    const final: ProjectDetail = await call('projects.get', slug)
    expect(final.versions.map((v) => v.n)).toEqual([1, 2, 3])
    expect(final.chat.filter((m) => m.from === 'you').map((m) => m.text)).toEqual(['Make the subtitles bigger', 'Make it louder'])
  }, 120_000)
})
