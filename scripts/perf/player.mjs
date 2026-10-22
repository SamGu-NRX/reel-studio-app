#!/usr/bin/env node
// Player audit: steady playback, responsiveness, version switches and a long session, measured in the real app.
// See the "Player audit" section of README.md for usage.
import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, constants, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cpus, loadavg } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import registryTools from './process-registry.cjs'
import { cleanupEngines } from './processes.mjs'
import { guard, fileHash } from './resources.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const require = createRequire(join(repo, 'package.json'))
const { values: opts } = parseArgs({
  options: {
    build: { type: 'string', multiple: true },
    resources: { type: 'string' },
    fixtures: { type: 'string' },
    out: { type: 'string' },
    scratch: { type: 'string' },
    preload: { type: 'string' },
    'preload-proof': { type: 'string' },
    runs: { type: 'string', default: '5' },
    seconds: { type: 'string', default: '30' },
    'long-seconds': { type: 'string', default: '300' },
    'long-switches': { type: 'string', default: '20' },
    'long-only': { type: 'boolean', default: false },
    'max-load': { type: 'string', default: '6' },
    profile: { type: 'boolean', default: false },
    'init-script': { type: 'string' },
    'seek-sweep': { type: 'boolean', default: false },
    vmmap: { type: 'boolean', default: false },
    'switch-by-key': { type: 'boolean', default: false }
  }
})
for (const key of ['build', 'resources', 'fixtures', 'out', 'scratch']) if (!opts[key]) throw new Error(`--${key} is required`)
if (!!opts.preload !== !!opts['preload-proof']) throw new Error('--preload and --preload-proof go together')
const builds = opts.build.map((b) => {
  const [name, dir] = b.split('=')
  if (!name || !dir || !existsSync(join(dir, 'out/main/index.js'))) throw new Error(`--build ${b}: expected name=<app dir with out/main/index.js>`)
  return { name, dir: realpathSync(dir) }
})
const runs = Number(opts.runs)
const seconds = Number(opts.seconds)
const longSeconds = Number(opts['long-seconds'])
const longSwitches = Number(opts['long-switches'])
const maxLoad = Number(opts['max-load'])
const output = resolve(opts.out)
const scratch = realpathSync(opts.scratch)
const resourcesDir = resolve(opts.resources)
const fixturesDir = resolve(opts.fixtures)
const abort = new AbortController()
const env = { ...process.env }
for (const k of Object.keys(env)) if (/API_KEY/.test(k) || k === 'ELECTRON_RUN_AS_NODE') delete env[k]
const json = (p, d) => writeFileSync(p, JSON.stringify(d, null, 2) + '\n')
const copy = (a, b) => copyFileSync(a, b, constants.COPYFILE_FICLONE)
const installPlayerProbe = require('./scripts/perf/player-probe.cjs')
const { registerProcess, captureDescendants } = registryTools
const executable = require('electron')

function check() {
  abort.signal.throwIfAborted()
  return guard(scratch)
}

/** Waits until the 1-minute load is at or below --max-load, and records the reading it started at. */
async function admission(phase) {
  let waited = 0
  for (;;) {
    check()
    const load = loadavg()
    if (load[0] <= maxLoad) return { phase, at: new Date().toISOString(), load, waitedS: waited }
    if (waited % 60 === 0) console.log(`WAIT ${phase}: 1-minute load ${load[0].toFixed(2)} > ${maxLoad}`)
    await delay(15000)
    waited += 15
  }
}

function probe(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,bit_rate:format=duration,size', '-of', 'json', file], { env, encoding: 'utf8' }))
}

// Each project's Version 2 is the clip under test and Version 1 a different real reel, so switches change
// the picture. The source is raw phone footage, for Hold for original.
const clips = [
  { name: 'reel30', file: 'reel30.mp4' },
  { name: 'reel60', file: 'reel60.mp4' }
]
function fixtures() {
  const list = [...clips, { name: 'alt30', file: 'alt30.mp4' }, { name: 'raw', file: 'raw.mov' }]
  const out = {}
  for (const c of list) {
    const file = join(fixturesDir, c.file)
    const cover = file.replace(/\.\w+$/, '.png')
    if (!existsSync(file)) throw new Error(`Missing fixture ${file}`)
    out[c.name] = { name: c.name, file, cover: existsSync(cover) ? cover : null, probe: probe(file) }
  }
  return out
}

function seed(runDir, fx) {
  const root = join(runDir, 'root')
  const userData = join(runDir, 'user-data')
  mkdirSync(userData, { recursive: true })
  json(join(userData, 'settings.json'), { firstRunDone: true, aiCarriedOver: true, root })
  const raw = fx.raw
  const rawDuration = Number(raw.probe.format.duration)
  for (const c of clips) {
    const dir = join(root, 'Projects', c.name)
    mkdirSync(join(dir, 'media'), { recursive: true })
    mkdirSync(join(dir, 'work'), { recursive: true })
    copy(raw.file, join(dir, 'media/source.mov'))
    json(join(dir, 'work/transcript.json'), { words: [{ id: 'w0000', w: 'Player', s: 0, e: 0.5, source: 'source' }, { id: 'w0001', w: 'audit', s: 0.5, e: 1, source: 'source' }] })
    json(join(dir, 'project.json'), { schemaVersion: 1, version: 2, createdAt: new Date().toISOString(), title: c.name, sources: [{ id: 'source', path: 'media/source.mov', duration: rawDuration }], transcript: { file: 'work/transcript.json' }, cut: { keep: [{ from: 'w0000', to: 'w0001' }] }, captions: { enabled: false }, post: { caption: '' }, updatedAt: new Date().toISOString() })
    json(join(dir, 'app.json'), { title: c.name, status: 'ready', job: null, chat: [], lastError: null, aiEdited: false })
    for (const [n, v] of [[1, fx.alt30], [2, fx[c.name]]]) {
      const vdir = join(dir, 'versions', `v${n}`)
      mkdirSync(vdir, { recursive: true })
      copy(v.file, join(vdir, 'export.mp4'))
      copy(v.cover, join(vdir, 'cover.png'))
      const duration = Number(v.probe.format.duration)
      json(join(vdir, 'render.json'), { duration, segmentsDetail: [{ source: 'source', src_start: 0, src_end: Math.min(duration, rawDuration), out_start: 0 }] })
    }
  }
  return { root, userData }
}

const percentile = (values, p) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}
const distribution = (values) => ({ n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.length ? Math.max(...values) : null })

async function arm(page, kind, selector, event = 'click', expected = null) {
  await page.evaluate(({ kind, selector, event, expected }) => window.__playerPerf.arm(kind, selector, event, expected), { kind, selector, event, expected })
}
async function changed(page, timeout = 3000) {
  try {
    await page.waitForFunction(() => !window.__playerPerf.action(), null, { timeout })
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
    return page.evaluate(() => window.__playerPerf.expireAction())
  }
  return page.evaluate(() => window.__playerPerf.actions.at(-1))
}

/** The players differ: main has one radio chip per version, the redesign a Versions sheet with "Watch it". */
async function pickVersion(page, n) {
  if (opts['switch-by-key'] && (await page.getByTestId('version-switch').count())) {
    // The picker's arrow keys pick the next or previous version without opening the Versions sheet.
    await page.getByTestId('version-switch').focus()
    await arm(page, 'switch', '[data-testid="version-switch"]', 'keydown', `/versions/v${n}/`)
    await page.keyboard.press(n === 1 ? 'ArrowLeft' : 'ArrowRight')
    return 'key'
  }
  if (await page.getByTestId('version-switch').count()) {
    await page.getByTestId('version-switch').click()
    const row = page.getByTestId(`version-item-${n}`)
    if (!(await row.getAttribute('class')).includes(' open')) await row.locator('.vr').click()
    const watch = page.getByTestId(`watch-${n}`)
    await watch.waitFor()
    await arm(page, 'switch', `[data-testid="watch-${n}"]`, 'click', `/versions/v${n}/`)
    await watch.click()
    return 'sheet'
  }
  const chip = page.getByRole('radio', { name: `Version ${n}`, exact: true })
  await arm(page, 'switch', `[data-testid="versions"] [role="radio"]`, 'click', `/versions/v${n}/`)
  await chip.click()
  return 'chip'
}

async function startComposite(app, page) {
  const box = await page.locator('.phone-screen').boundingBox()
  await app.evaluate((_electron, box) => {
    globalThis.__playerComposite = []
    globalThis.__playerWindow.webContents.beginFrameSubscription(false, (image) => {
      const small = image.crop({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }).resize({ width: 10, height: 16 })
      const bitmap = small.toBitmap()
      let max = 0
      let min = 255
      // Skip the centre, where the play button sits.
      for (let y = 1; y < 15; y++)
        for (let x = 1; x < 9; x++) {
          if (y >= 6 && y <= 9 && x >= 3 && x <= 6) continue
          for (let c = 0; c < 3; c++) {
            const value = bitmap[(y * 10 + x) * 4 + c]
            max = Math.max(max, value)
            min = Math.min(min, value)
          }
        }
      globalThis.__playerComposite.push({ at: Date.now(), black: max < 16, uniform: max - min < 4 })
    })
  }, box)
}
async function stopComposite(app) {
  return app.evaluate(() => {
    globalThis.__playerWindow.webContents.endFrameSubscription()
    return globalThis.__playerComposite
  })
}

async function switchVersion(page, app, n, composite = false) {
  check()
  await page.evaluate(() => document.querySelector('[data-testid="player"]')?.pause())
  if (composite) await startComposite(app, page)
  const via = await pickVersion(page, n)
  const result = await changed(page)
  let settledMs = null
  try {
    await page.waitForFunction((n) => {
      const v = document.querySelector('[data-testid="player"]')
      return v && decodeURIComponent(v.currentSrc).includes(`/versions/v${n}/`) && Number(getComputedStyle(v).opacity) >= 0.99 && document.querySelectorAll('.phone-screen video.layer').length <= 1
    }, n, { timeout: 5000 })
    if (result.start !== null) settledMs = await page.evaluate((start) => performance.now() - start, result.start)
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
  }
  await page.waitForTimeout(300)
  const raf = await page.evaluate(() => window.__playerPerf.stopMonitor())
  const frames = composite ? await stopComposite(app) : null
  await page.evaluate(() => document.querySelector('[data-testid="player"]')?.pause())
  const during = raf.filter((f) => result.start !== null && f.at >= result.start && (settledMs === null || f.at <= result.start + settledMs))
  const compositeDuring = frames?.filter((f) => result.wallStart && f.at >= result.wallStart && f.at <= result.wallStart + (settledMs ?? 1000))
  return {
    n,
    via,
    ms: result.ms,
    pictureKind: result.pictureKind ?? null,
    unavailable: result.unavailable ?? null,
    settledMs,
    rafDuring: during.length,
    blankRaf: during.filter((f) => f.pictured === 0).length,
    maxVideos: Math.max(0, ...raf.map((f) => f.videos)),
    composite: compositeDuring ? { samples: compositeDuring.length, black: compositeDuring.filter((f) => f.black).length, uniform: compositeDuring.filter((f) => f.uniform).length } : null
  }
}

async function openReel(page, name) {
  const selector = `[data-testid="project-card"][title="${name}"]`
  await page.locator(selector).waitFor()
  await arm(page, 'open', selector, 'click', '/versions/v2/')
  await page.locator(selector).click()
  return changed(page, 8000)
}

function preflight() {
  if (!opts.preload) return null
  const proof = resolve(opts['preload-proof'])
  const lines = () => (existsSync(proof) ? readFileSync(proof, 'utf8').trim().split('\n').filter(Boolean).length : 0)
  const app = join(scratch, 'preflight-app')
  mkdirSync(app, { recursive: true })
  json(join(app, 'package.json'), { name: 'player-preflight', main: 'main.cjs' })
  writeFileSync(join(app, 'main.cjs'), "const { app } = require('electron')\napp.whenReady().then(() => app.quit())\nsetTimeout(() => process.exit(0), 3000)\n")
  const before = lines()
  spawnSync(executable, ['--inspect=0', '-r', resolve(opts.preload), app], { env, timeout: 20000, stdio: 'ignore' })
  if (lines() <= before) throw new Error(`Preflight: ${opts.preload} did not write its proof line to ${proof}; nothing was launched`)
  return readFileSync(proof, 'utf8').trim().split('\n').at(-1)
}
function provePreload(pid) {
  if (!opts.preload) return null
  const line = readFileSync(resolve(opts['preload-proof']), 'utf8').split('\n').find((l) => l.includes(`pid=${pid} `))
  if (!line) throw new Error(`The preload has no proof line for Electron pid ${pid}; aborting this launch`)
  return line
}

/** CPU time a process type used between two getAppMetrics readings, as a percentage of one core. */
function cpuPercent(first, firstAt, last, type) {
  const before = new Map(first.filter((p) => p.type === type).map((p) => [p.pid, p.cpuS]))
  const used = last.processes.filter((p) => p.type === type && before.has(p.pid)).reduce((a, p) => a + p.cpuS - before.get(p.pid), 0)
  return (100 * used) / ((last.at - firstAt) / 1000)
}

async function measurePlayback(page, app, build, run, clip, result, save) {
  for (let attempt = 1; ; attempt++) {
    const load = await admission(`${build}-${run}-${clip}-playback`)
    await page.evaluate(async () => {
      const v = document.querySelector('[data-testid="player"]')
      v.muted = true
      v.loop = true
      v.currentTime = 0
      await v.play()
    })
    await page.waitForTimeout(1000)
    const metrics = () => app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpuS: m.cpu.cumulativeCPUUsage, rssKiB: m.memory.workingSetSize })))
    const first = await metrics()
    const firstAt = Date.now()
    await page.evaluate(() => window.__playerPerf.beginPlayback())
    const start = await page.evaluate(() => window.__playerPerf.snapshot())
    const samples = []
    const until = Date.now() + seconds * 1000
    while (Date.now() < until) {
      check()
      await delay(1000)
      samples.push({ at: Date.now(), load: loadavg(), processes: await metrics() })
    }
    const end = await page.evaluate(() => {
      const s = window.__playerPerf.snapshot()
      window.__playerPerf.endPlayback()
      document.querySelector('[data-testid="player"]').pause()
      return s
    })
    const telemetry = await page.evaluate(({ start, end }) => ({ frames: window.__playerPerf.frames.filter((f) => f.at >= start && f.at <= end), tasks: window.__playerPerf.tasks.filter((t) => t.at >= start && t.at <= end), raf: window.__playerPerf.rafTimes.filter((t) => t >= start && t <= end) }), { start: start.at, end: end.at })
    const overload = samples.filter((s) => s.load[0] > maxLoad).length
    const player = end.videos.find((v) => v.testid === 'player')
    const q0 = start.videos.find((v) => v.id === player.id)?.quality
    const frames = telemetry.frames.filter((f) => f.id === player.id)
    // Expected display time steps between presented frames; a step over 1.5 source frames means a skipped frame.
    const steps = frames.slice(1).map((f, i) => f.expected - frames[i].expected)
    const mediaSteps = frames.slice(1).map((f, i) => f.media - frames[i].media).filter((d) => d > 0)
    const [num, den] = result.fixtures[clip].probe.streams[0].avg_frame_rate.split('/').map(Number)
    const fps = num / den
    const sourceFrameMs = 1000 / fps
    const row = {
      clip,
      attempt,
      load,
      overloadSamples: overload,
      wallMs: end.at - start.at,
      presented: frames.length,
      presentedPerS: frames.length / ((end.at - start.at) / 1000),
      expectedPerS: fps,
      mediaSkips: mediaSteps.filter((d) => d > (1.5 * sourceFrameMs) / 1000).length,
      totalFrames: q0 ? player.quality.total - q0.total : null,
      droppedFrames: q0 ? player.quality.dropped - q0.dropped : null,
      gaps: distribution(steps),
      processingMs: distribution(frames.map((f) => f.processingMs)),
      rafGaps: distribution(telemetry.raf.slice(1).map((t, i) => t - telemetry.raf[i])),
      commits: end.commits - start.commits,
      longTasks: telemetry.tasks.length,
      longTaskMs: telemetry.tasks.reduce((sum, t) => sum + t.ms, 0),
      rendererCpu: cpuPercent(first, firstAt, samples.at(-1), 'Tab'),
      gpuCpu: cpuPercent(first, firstAt, samples.at(-1), 'GPU'),
      browserCpu: cpuPercent(first, firstAt, samples.at(-1), 'Browser'),
      samples
    }
    if (overload && attempt < 3) {
      result.discarded.push(row)
      save()
      console.log(`RETRY ${build} ${run} ${clip}: load over ${maxLoad} in ${overload} samples`)
      continue
    }
    result.playback.push(row)
    save()
    console.log(`PLAYBACK ${build} ${run} ${clip}: ${row.presentedPerS.toFixed(1)}/s presented, ${row.droppedFrames} dropped, gap p95 ${row.gaps.p95?.toFixed(1)} ms, commits ${row.commits}, renderer ${row.rendererCpu?.toFixed(1)}%`)
    return
  }
}

async function responsiveness(page, app, build, run, clip, result) {
  result.loads.push(await admission(`${build}-${run}-${clip}-actions`))
  const add = (row) => result.actions.push({ clip, ...row })
  await page.evaluate(() => {
    const v = document.querySelector('[data-testid="player"]')
    v.pause()
    v.currentTime = 0
  })
  await page.waitForTimeout(500)
  await arm(page, 'play', '[data-testid="play"]')
  await page.getByTestId('play').click()
  add(await changed(page))
  await page.waitForTimeout(1500)
  await arm(page, 'click-seek', 'input[aria-label="Position in the video"]', 'input')
  const slider = page.getByRole('slider', { name: 'Position in the video' })
  const box = await slider.boundingBox()
  await page.mouse.click(box.x + box.width * 0.65, box.y + box.height / 2)
  add(await changed(page))
  await page.evaluate(() => document.querySelector('[data-testid="player"]').pause())
  await page.waitForTimeout(300)
  await arm(page, 'click-seek-paused', 'input[aria-label="Position in the video"]', 'input')
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2)
  add(await changed(page))
  await page.evaluate(() => window.__playerPerf.beginScrub())
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
  await page.mouse.down()
  const dragStart = Date.now()
  // A hand drag: 30 moves about 16 ms apart, so the input events are not all coalesced into one.
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + (0.55 * i) / 30), box.y + box.height / 2)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  const dragMs = Date.now() - dragStart
  try {
    await page.waitForFunction(() => !window.__playerPerf.scrub().pending, null, { timeout: 2000 })
  } catch (error) {
    if (error.name !== 'TimeoutError') throw error
  }
  const scrub = await page.evaluate(() => window.__playerPerf.endScrub())
  add({ kind: 'scrub', dragMs, inputs: scrub.inputs, landed: scrub.frames.length, finalLanded: !scrub.pending, finalMs: scrub.pending ? null : scrub.frames.at(-1)?.ms ?? null, ms: percentile(scrub.frames.map((f) => f.ms), 0.5), gaps: distribution(scrub.frames.map((f) => f.ms)) })
  for (const n of [1, 2]) result.switches.push({ clip, ...(await switchVersion(page, app, n)) })
  for (const n of [1, 2]) result.switches.push({ clip, blankCheck: true, ...(await switchVersion(page, app, n, true)) })
  await page.evaluate(() => {
    const v = document.querySelector('[data-testid="player"]')
    v.pause()
    v.currentTime = 2
  })
  await page.waitForTimeout(500)
  await page.getByTestId('hold-original').hover()
  await page.waitForTimeout(300)
  await arm(page, 'hold', '[data-testid="hold-original"]', 'pointerdown')
  await page.mouse.down()
  add(await changed(page))
  await page.waitForTimeout(500)
  await page.mouse.up()
  await page.mouse.move(0, 0)
}

/** Memory after a forced GC: native process memory next to the JS heap, to tell a JS leak from a native one. */
async function leakSample(page, cdp, app, media) {
  await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(500)
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, rssKiB: m.memory.workingSetSize })))
  const mib = (type) => metrics.filter((m) => m.type === type).reduce((a, m) => a + m.rssKiB, 0) / 1024
  const renderer = await page.evaluate(() => ({ videos: document.querySelectorAll('video').length, withSrc: [...document.querySelectorAll('video')].filter((v) => v.hasAttribute('src')).length }))
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  return { at: Date.now(), load: loadavg()[0], rendererMiB: mib('Tab'), gpuMiB: mib('GPU'), browserMiB: mib('Browser'), utilityMiB: mib('Utility'), heapMiB: heap.usedSize / 1024 ** 2, ...renderer, mediaPlayersLive: media.live.size, mediaPlayersCreated: media.created, domNodes: dom.nodes }
}

/**
 * Paused seeks set from script to fixed distances after a keyframe: the decoder must decode from the keyframe
 * to the target, so this isolates the footage's keyframe spacing from the player's input handling.
 */
async function seekSweep(page, clip, result) {
  const key = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', result.fixtures[clip].file], { encoding: 'utf8' }).split(/[\s,]+/).map(Number).filter((t) => t > 2.5)[0])
  for (const after of [0.05, 1, 2.5, 4]) {
    for (let rep = 0; rep < 3; rep++) {
      const ms = await page.evaluate(async (target) => {
        const v = document.querySelector('[data-testid="player"]')
        v.pause()
        v.currentTime = 0
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }))
        await new Promise((r) => setTimeout(r, 200))
        const start = performance.now()
        v.currentTime = target
        return new Promise((resolve) => {
          const wait = (now, m) => (Math.abs(m.mediaTime - target) < 0.05 ? resolve(now - start) : v.requestVideoFrameCallback(wait))
          v.requestVideoFrameCallback(wait)
          setTimeout(() => resolve(null), 3000)
        })
      }, key + after)
      result.seekSweep = [...(result.seekSweep ?? []), { clip, keyframe: key, after, ms }]
    }
  }
}

/**
 * macOS only, with --vmmap: the renderer's memory by region from `vmmap -summary`. Chromium tags PartitionAlloc
 * pages 253 and V8 pages 255. Dirty plus swapped counts memory the system had to compress, which RSS misses.
 */
async function rendererRegions(app) {
  if (!opts.vmmap) return null
  const pids = (await app.evaluate(({ app }) => app.getAppMetrics().filter((m) => m.type === 'Tab').map((m) => m.pid)))
  const out = {}
  const mib = (v) => Number(v.replace(/[KMG]$/, '')) * { K: 1 / 1024, M: 1, G: 1024 }[v.at(-1)]
  for (const pid of pids) {
    const text = execFileSync('vmmap', ['-summary', String(pid)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    for (const name of ['Memory Tag 253', 'Memory Tag 255', 'IOSurface', 'shared memory', 'TOTAL']) {
      const line = text.split('\n').find((l) => l.startsWith(name + ' ') && !l.includes('(reserved)'))
      if (!line) continue
      const [, resident, dirty, swapped] = line.slice(name.length).trim().split(/\s+/)
      out[name] = { residentMiB: mib(resident), dirtyMiB: mib(dirty), swappedMiB: mib(swapped) }
    }
  }
  return out
}

async function memory(page, cdp, app, media) {
  await cdp.send('HeapProfiler.collectGarbage')
  return {
    renderer: await page.evaluate(() => window.__playerPerf.snapshot()),
    heap: await cdp.send('Runtime.getHeapUsage'),
    dom: await cdp.send('Memory.getDOMCounters'),
    processes: await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, rssKiB: m.memory.workingSetSize }))),
    mediaPlayersLive: media.live.size,
    mediaPlayersCreated: media.created
  }
}

/** Self time per function in a V8 CPU profile, highest first. */
function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const self = new Map()
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)))
  const byFn = new Map()
  for (const [id, us] of self) {
    const f = nodes.get(id).callFrame
    const key = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.lineNumber + 1}:${f.columnNumber + 1}`
    byFn.set(key, (byFn.get(key) ?? 0) + us)
  }
  const total = [...byFn.values()].reduce((a, b) => a + b, 0)
  return { totalMs: total / 1000, top: [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([fn, us]) => ({ fn, ms: us / 1000 })) }
}

/** Wall time of complete trace events on the renderer main thread, by event name, for the traced interval. */
function traceSummary(trace) {
  const events = trace.traceEvents ?? trace
  const thread = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
  const main = events.filter((e) => e.ph === 'X' && thread && e.pid === thread.pid && e.tid === thread.tid)
  const ts = main.map((e) => e.ts)
  const spanMs = ts.length ? (Math.max(...ts) - Math.min(...ts)) / 1000 : 0
  const byName = new Map()
  for (const e of main) {
    const row = byName.get(e.name) ?? { count: 0, ms: 0 }
    row.count++
    row.ms += (e.dur ?? 0) / 1000
    byName.set(e.name, row)
  }
  return { spanMs, top: [...byName].sort((a, b) => b[1].ms - a[1].ms).slice(0, 25).map(([name, r]) => ({ name, ...r })) }
}

async function oneRun(build, run, fx, manifest) {
  const runDir = join(scratch, 'runs', `${build.name}-${run}`)
  const registry = join(runDir, 'processes.jsonl')
  if (existsSync(registry) && captureDescendants(registry).length) throw new Error(`Owned processes from ${runDir} are still alive`)
  rmSync(runDir, { recursive: true, force: true })
  const paths = seed(runDir, fx)
  mkdirSync(join(runDir, 'tmp'), { recursive: true })
  const result = { build: build.name, run, loads: [await admission(`${build.name}-${run}-launch`)], fixtures: fx, playback: [], discarded: [], openings: [], actions: [], switches: [], errors: [] }
  const file = join(output, `${build.name}-${run}.json`)
  const save = () => json(file, result)
  const launchEnv = {
    ...env,
    REELSTUDIO_ENGINE_DIR: join(resourcesDir, 'engine'),
    REELSTUDIO_PYTHON: join(resourcesDir, 'python/bin/python3'),
    REELENGINE_FFMPEG: join(resourcesDir, 'ffmpeg/ffmpeg'),
    REELENGINE_FFPROBE: join(resourcesDir, 'ffmpeg/ffprobe'),
    REELSTUDIO_TEST: '1',
    REELSTUDIO_MOCK_AI: '1',
    REELSTUDIO_USER_DATA: paths.userData,
    REELSTUDIO_ROOT: paths.root,
    REELSTUDIO_MODELS_DIR: join(runDir, 'models'),
    REELENGINE_CACHE: join(runDir, 'engine-cache'),
    TMPDIR: join(runDir, 'tmp'),
    REELSTUDIO_PERF_PID_REGISTRY: registry
  }
  const { _electron: electron } = require('@playwright/test')
  console.log(`START ${build.name} ${run}`)
  const args = [...(opts.preload ? ['-r', resolve(opts.preload)] : []), build.dir, `--user-data-dir=${paths.userData}`]
  const app = await electron.launch({ executablePath: executable, args, cwd: runDir, env: launchEnv, timeout: 60000 })
  let processTimer
  try {
    registerProcess(registry, app.process().pid)
    result.preloadProof = provePreload(app.process().pid)
    processTimer = setInterval(() => captureDescendants(registry), 1000)
    const page = await app.firstWindow()
    page.setDefaultTimeout(15000)
    result.runtime = await app.evaluate(({ app, BrowserWindow }) => ({ versions: process.versions, packaged: app.isPackaged, appPath: app.getAppPath(), windows: BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), focused: w.isFocused(), bounds: w.getBounds(), content: w.getContentBounds() })), hidden: globalThis.__playerWindows ?? null }))
    if (opts.preload && result.runtime.windows.some((w) => w.visible || w.focused)) throw new Error('A window is visible or focused despite the preload')
    await page.addInitScript(installPlayerProbe)
    if (opts['init-script']) await page.addInitScript({ path: resolve(opts['init-script']) })
    await page.reload()
    page.on('pageerror', (e) => result.errors.push(String(e)))
    await page.getByTestId('project-card').first().waitFor()
    result.visibility = await page.evaluate(() => ({ state: document.visibilityState, hidden: document.hidden, dpr: devicePixelRatio, inner: [innerWidth, innerHeight] }))
    const cdp = await page.context().newCDPSession(page)
    const media = { live: new Set(), created: 0, decoders: {} }
    cdp.on('Media.playerCreated', (e) => {
      media.live.add(e.player.playerId)
      media.created++
    })
    cdp.on('Media.playerEventsAdded', (e) => {
      for (const event of e.events) if (/kWebMediaPlayerDestroyed/.test(event.value)) media.live.delete(e.playerId)
    })
    cdp.on('Media.playerPropertiesChanged', (e) => {
      for (const p of e.properties) if (p.name === 'kVideoDecoderName') media.decoders[p.value] = (media.decoders[p.value] ?? 0) + 1
    })
    await cdp.send('Media.enable')
    for (const clip of opts['long-only'] ? [] : clips.map((c) => c.name)) {
      result.loads.push(await admission(`${build.name}-${run}-${clip}-open`))
      result.openings.push({ clip, ...(await openReel(page, clip)) })
      await page.getByTestId('player').waitFor()
      result.layout ??= await page.evaluate(() => ({ phone: document.querySelector('.phone-screen')?.getBoundingClientRect().toJSON(), video: document.querySelector('[data-testid="player"]')?.getBoundingClientRect().toJSON() }))
      await measurePlayback(page, app, build.name, run, clip, result, save)
      await responsiveness(page, app, build.name, run, clip, result)
      if (opts['seek-sweep']) await seekSweep(page, clip, result)
      save()
      const png = await app.evaluate(() => globalThis.__playerWindow.webContents.capturePage().then((image) => image.toPNG().toString('base64')))
      writeFileSync(join(output, `${build.name}-${run}-${clip}.png`), Buffer.from(png, 'base64'))
      await page.getByTestId('nav-home').click()
      await page.getByTestId('project-card').first().waitFor()
    }
    result.decoders = media.decoders
    if (longSeconds > 0 || opts['long-only']) {
      await openReel(page, 'reel30')
      result.loads.push(await admission(`${build.name}-${run}-long`))
      const long = (result.longSession = { before: await memory(page, cdp, app, media), switches: [], samples: [] })
      long.memory = [{ switches: 0, ...(await leakSample(page, cdp, app, media)), regions: await rendererRegions(app) }]
      for (let i = 0; i < longSwitches; i++) {
        long.switches.push(await switchVersion(page, app, i % 2 ? 2 : 1))
        if ((i + 1) % 5 === 0) long.memory.push({ switches: i + 1, ...(await leakSample(page, cdp, app, media)), ...(i + 1 === longSwitches ? { regions: await rendererRegions(app) } : {}) })
      }
      long.afterSwitches = await memory(page, cdp, app, media)
      // Retained versus leaked: memory the renderer can give back returns under pressure or after idling.
      await page.waitForTimeout(60000)
      long.afterIdle = await leakSample(page, cdp, app, media)
      await cdp.send('Memory.simulatePressureNotification', { level: 'critical' })
      await page.waitForTimeout(3000)
      long.afterPressure = await leakSample(page, cdp, app, media)
      await page.evaluate(async () => {
        const v = document.querySelector('[data-testid="player"]')
        v.muted = true
        v.loop = true
        await v.play()
      })
      for (let s = 1; s <= longSeconds; s++) {
        check()
        await delay(1000)
        if (s % 60 === 0) {
          long.samples.push({ s, load: loadavg(), processes: await app.evaluate(({ app }) => app.getAppMetrics().map((m) => ({ type: m.type, rssKiB: m.memory.workingSetSize }))) })
          save()
        }
      }
      await page.evaluate(() => document.querySelector('[data-testid="player"]').pause())
      long.after = await memory(page, cdp, app, media)
      save()
    }
    if (opts.profile) {
      result.loads.push(await admission(`${build.name}-${run}-profile`))
      await page.getByTestId('nav-home').click()
      await openReel(page, 'reel30')
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
      await cdp.send('Profiler.start')
      await page.evaluate(async () => {
        const v = document.querySelector('[data-testid="player"]')
        v.muted = true
        await v.play()
      })
      await page.waitForTimeout(10000)
      const { profile: playing } = await cdp.send('Profiler.stop')
      json(join(output, `${build.name}-${run}-playback.cpuprofile`), playing)
      result.profile = { playback: profileSummary(playing) }
      const tracePath = join(scratch, 'runs', `${build.name}-${run}`, 'trace.json')
      await app.evaluate(({ contentTracing }) => contentTracing.startRecording({ included_categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink', 'cc', 'gpu', 'viz', 'media'] }))
      await page.waitForTimeout(5000)
      await app.evaluate(({ contentTracing }, path) => contentTracing.stopRecording(path), tracePath)
      result.profile.trace = traceSummary(JSON.parse(readFileSync(tracePath, 'utf8')))
      save()
      await cdp.send('Profiler.start')
      for (let i = 0; i < 6; i++) await switchVersion(page, app, i % 2 ? 2 : 1)
      const { profile: switching } = await cdp.send('Profiler.stop')
      json(join(output, `${build.name}-${run}-switch.cpuprofile`), switching)
      result.profile.switching = profileSummary(switching)
    }
    result.react = await page.evaluate(() => ({ renderers: window.__playerPerf.renderers, commits: window.__playerPerf.commits }))
    if (!result.react.renderers) throw new Error('The React commit hook did not attach')
    result.windowState = await app.evaluate(({ BrowserWindow }) => ({ hidden: globalThis.__playerWindows ?? null, windows: BrowserWindow.getAllWindows().map((w) => ({ visible: w.isVisible(), focused: w.isFocused() })) }))
    if (result.windowState.hidden?.errors.length || result.windowState.windows.some((w) => w.visible || w.focused)) throw new Error('An audit window became visible or focused')
    save()
  } catch (error) {
    result.errors.push(String(error.stack ?? error))
    save()
    const png = await app.evaluate(() => globalThis.__playerWindow?.webContents.capturePage().then((image) => image.toPNG().toString('base64'))).catch(() => null)
    if (png) writeFileSync(join(output, `${build.name}-${run}-error.png`), Buffer.from(png, 'base64'))
    throw error
  } finally {
    clearInterval(processTimer)
    captureDescendants(registry)
    const closed = await Promise.race([app.close().then(() => true, () => true), delay(20000).then(() => false)])
    if (!closed) result.errors.push('app.close() did not finish in 20 s; cleanup signalled the registered processes')
    result.cleanup = await cleanupEngines(scratch, registry)
    save()
  }
  rmSync(runDir, { recursive: true })
  manifest.runs.push({ build: build.name, run, complete: true })
  json(join(output, 'manifest.json'), manifest)
  console.log(`DONE ${build.name} ${run}`)
}

async function main() {
  mkdirSync(output, { recursive: true })
  mkdirSync(join(scratch, 'runs'), { recursive: true })
  const proof = preflight()
  const fx = fixtures()
  for (const c of Object.values(fx)) c.sha256 = await fileHash(c.file)
  const manifestPath = join(output, 'manifest.json')
  const buildInfo = await Promise.all(builds.map(async (b) => ({ ...b, mainHash: await fileHash(join(b.dir, 'out/main/index.js')), rendererFiles: execFileSync('ls', [join(b.dir, 'out/renderer/assets')], { encoding: 'utf8' }).trim().split('\n') })))
  const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
  if (existing && JSON.stringify(existing.builds) !== JSON.stringify(buildInfo)) throw new Error('The builds changed; move the previous output away before resuming')
  const manifest = existing ?? { started: new Date().toISOString(), builds: buildInfo, harness: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), electron: require('electron/package.json').version, preloadProof: proof, maxLoad, runs: [], errors: [], host: { model: execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim(), os: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(), cpu: cpus()[0].model, cores: cpus().length } }
  json(manifestPath, manifest)
  const stop = () => abort.abort(new Error('Player audit interrupted'))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    for (let run = 1; run <= runs; run++)
      for (const build of builds) {
        if (manifest.runs.some((r) => r.build === build.name && r.run === run && r.complete)) continue
        await oneRun(build, run, fx, manifest)
      }
  } catch (caught) {
    manifest.errors.push(String((abort.signal.aborted ? abort.signal.reason : caught).stack))
    json(manifestPath, manifest)
    throw caught
  }
  console.log('PLAYER_AUDIT_COMPLETE')
}
main().catch((e) => {
  console.error(e)
  process.exitCode = /Resource stop/.test(e.message) ? 2 : 1
})
