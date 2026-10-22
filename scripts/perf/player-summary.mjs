#!/usr/bin/env node
// Summarizes a player.mjs output folder: medians [min, max] across complete runs, per build.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const output = process.argv[2]
if (!output) throw new Error('usage: player-summary.mjs <player.mjs --out folder>')
const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'))
const builds = manifest.builds.map((b) => b.name)
const runs = manifest.runs.filter((r) => r.complete).map(({ build, run }) => JSON.parse(readFileSync(join(output, `${build}-${run}.json`), 'utf8')))
// A slow quit is a teardown problem, not a measurement one: cleanup then signals the run's own processes.
const closeTimeout = (e) => e.startsWith('app.close() did not finish')
for (const r of runs) if (r.errors.some((e) => !closeTimeout(e)) || r.cleanup?.survivors?.length) throw new Error(`${r.build}-${r.run} has errors or surviving processes`)

const nums = (values) => values.filter((v) => typeof v === 'number' && Number.isFinite(v))
const median = (values) => {
  const s = nums(values).sort((a, b) => a - b)
  if (!s.length) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const stat = (values) => {
  const n = nums(values)
  return n.length ? { n: n.length, median: median(n), min: Math.min(...n), max: Math.max(...n) } : { n: 0 }
}
const fmt = (s, digits = 1) => (s.n ? `${s.median.toFixed(digits)} [${s.min.toFixed(digits)}–${s.max.toFixed(digits)}]` : 'n/a')
const byBuild = (b) => runs.filter((r) => r.build === b)
const sum = (list) => list.reduce((a, b) => a + b, 0)

const rows = []
const metric = (label, pick, digits = 1) => {
  const stats = builds.map((b) => stat(byBuild(b).map(pick)))
  rows.push({ label, stats })
  return `| ${label} | ${stats.map((s) => fmt(s, digits)).join(' | ')} |`
}
const playback = (r, clip) => r.playback.find((p) => p.clip === clip)
const action = (r, clip, kind) => r.actions.find((a) => a.clip === clip && a.kind === kind)
const switches = (r, clip, blank) => r.switches.filter((s) => s.clip === clip && !!s.blankCheck === blank)

const lines = [`Runs per build: ${builds.map((b) => `${b} ${byBuild(b).length}`).join(', ')}. Values are medians [min–max] across runs; each run contributes one value (its own median where it has several).`, '']
for (const clip of ['reel30', 'reel60']) {
  lines.push(`### Steady playback, ${clip}, ${runs[0]?.playback.find((p) => p.clip === clip)?.wallMs ? Math.round(runs[0].playback.find((p) => p.clip === clip).wallMs / 1000) : '?'} s`, '', `| Metric | ${builds.join(' | ')} |`, `|---|${builds.map(() => '---:').join('|')}|`)
  lines.push(
    metric('Frames presented per second', (r) => playback(r, clip)?.presentedPerS),
    metric('Dropped frames (getVideoPlaybackQuality)', (r) => playback(r, clip)?.droppedFrames, 0),
    metric('Skipped source frames (media time jumps)', (r) => playback(r, clip)?.mediaSkips, 0),
    metric('Frame gap p50, ms', (r) => playback(r, clip)?.gaps.p50),
    metric('Frame gap p95, ms', (r) => playback(r, clip)?.gaps.p95),
    metric('Frame gap max, ms', (r) => playback(r, clip)?.gaps.max),
    metric('Animation frame gap p95, ms', (r) => playback(r, clip)?.rafGaps.p95),
    metric('Animation frame gap max, ms', (r) => playback(r, clip)?.rafGaps.max),
    metric('React commits', (r) => playback(r, clip)?.commits, 0),
    metric('Long tasks', (r) => playback(r, clip)?.longTasks, 0),
    metric('Renderer CPU, % of a core', (r) => playback(r, clip)?.rendererCpu),
    metric('GPU process CPU, % of a core', (r) => playback(r, clip)?.gpuCpu),
    metric('Main process CPU, % of a core', (r) => playback(r, clip)?.browserCpu),
    metric('Start load (1 min)', (r) => playback(r, clip)?.load.load[0], 2),
    ''
  )
}
lines.push('### Responsiveness, input to changed picture (ms)', '', `| Action | ${builds.join(' | ')} |`, `|---|${builds.map(() => '---:').join('|')}|`)
for (const clip of ['reel30', 'reel60']) {
  lines.push(
    metric(`Open reel to first picture, ${clip}`, (r) => r.openings.find((o) => o.clip === clip)?.ms),
    metric(`Play to first new frame, ${clip}`, (r) => action(r, clip, 'play')?.ms),
    metric(`Click-seek while playing, ${clip}`, (r) => action(r, clip, 'click-seek')?.ms),
    metric(`Click-seek while paused, ${clip}`, (r) => action(r, clip, 'click-seek-paused')?.ms),
    metric(`Scrub: input to frame p50, ${clip}`, (r) => action(r, clip, 'scrub')?.gaps.p50),
    metric(`Scrub: input to frame p95, ${clip}`, (r) => action(r, clip, 'scrub')?.gaps.p95),
    metric(`Scrub: inputs that got a frame, %, ${clip}`, (r) => {
      const a = action(r, clip, 'scrub')
      return a ? (100 * a.landed) / a.inputs : null
    }, 0),
    metric(`Scrub: release to final frame, ${clip}`, (r) => action(r, clip, 'scrub')?.finalMs),
    metric(`Hold for original, ${clip}`, (r) => action(r, clip, 'hold')?.ms)
  )
}
lines.push('', '### Version switch', '', `| Metric | ${builds.join(' | ')} |`, `|---|${builds.map(() => '---:').join('|')}|`)
for (const clip of ['reel30', 'reel60']) {
  lines.push(
    metric(`Click to new picture, ms, ${clip}`, (r) => median(switches(r, clip, false).map((s) => s.ms))),
    metric(`Click to fully shown, ms, ${clip}`, (r) => median(switches(r, clip, false).map((s) => s.settledMs))),
    metric(`Blank animation frames per switch, ${clip}`, (r) => median(switches(r, clip, false).map((s) => s.blankRaf)), 1),
    metric(`Black composited frames per switch, ${clip}`, (r) => median(switches(r, clip, true).map((s) => s.composite?.black)), 1),
    metric(`Composited frames sampled per switch, ${clip}`, (r) => median(switches(r, clip, true).map((s) => s.composite?.samples)), 0)
  )
}
const long = (r, stage, f) => (r.longSession?.[stage] ? f(r.longSession[stage]) : null)
const rss = (m, type) => sum(m.processes.filter((p) => p.type === type).map((p) => p.rssKiB)) / 1024
lines.push('', '### Long session (20 switches, then 5 minutes of playback)', '', `| Metric | ${builds.join(' | ')} |`, `|---|${builds.map(() => '---:').join('|')}|`)
for (const [stage, name] of [['before', 'before'], ['afterSwitches', 'after switches'], ['after', 'after playback']]) {
  lines.push(
    metric(`Renderer RSS, MiB, ${name}`, (r) => long(r, stage, (m) => rss(m, 'Tab'))),
    metric(`GPU process RSS, MiB, ${name}`, (r) => long(r, stage, (m) => rss(m, 'GPU'))),
    metric(`JS heap used, MiB, ${name}`, (r) => long(r, stage, (m) => m.heap.usedSize / 1024 ** 2)),
    metric(`<video> elements, ${name}`, (r) => long(r, stage, (m) => m.renderer.videos.length), 0),
    metric(`<video> elements holding a source, ${name}`, (r) => long(r, stage, (m) => m.renderer.videos.filter((v) => v.hasSrc).length), 0),
    metric(`Live media players, ${name}`, (r) => long(r, stage, (m) => m.mediaPlayersLive), 0),
    metric(`DOM nodes, ${name}`, (r) => long(r, stage, (m) => m.dom.nodes), 0)
  )
}
lines.push(metric('Switch click to new picture, ms, long session median', (r) => median(r.longSession?.switches.map((s) => s.ms) ?? [])))
const slope = (points) => {
  if (points.length < 2) return null
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length
  const my = points.reduce((a, p) => a + p[1], 0) / points.length
  const den = points.reduce((a, p) => a + (p[0] - mx) ** 2, 0)
  return den ? points.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / den : null
}
const leak = (r, key) => (r.longSession?.memory?.length > 1 ? slope(r.longSession.memory.map((m) => [m.switches, m[key]])) : null)
const region = (r, name) => {
  const m = r.longSession?.memory
  const a = m?.[0].regions?.[name]
  const b = m?.at(-1).regions?.[name]
  return a && b ? (b.dirtyMiB + b.swappedMiB - a.dirtyMiB - a.swappedMiB) / m.at(-1).switches : null
}
const leakRuns = runs.filter((r) => r.longSession?.memory?.length > 1)
if (leakRuns.length) {
  const most = Math.max(...leakRuns.map((r) => r.longSession.memory.at(-1).switches))
  lines.push('', `### Memory across ${most} version switches (after a forced GC every 5 switches)`, '', `| Metric | ${builds.join(' | ')} |`, `|---|${builds.map(() => '---:').join('|')}|`)
  lines.push(
    metric('Renderer RSS growth, MiB per switch', (r) => leak(r, 'rendererMiB'), 2),
    metric('GPU process RSS growth, MiB per switch', (r) => leak(r, 'gpuMiB'), 2),
    metric('JS heap growth, MiB per switch', (r) => leak(r, 'heapMiB'), 3),
    metric('PartitionAlloc dirty+swapped growth, MiB per switch (vmmap)', (r) => region(r, 'Memory Tag 253'), 2),
    metric('Shared memory dirty+swapped growth, MiB per switch (vmmap)', (r) => region(r, 'shared memory'), 2),
    metric('Renderer RSS at start, MiB', (r) => r.longSession?.memory?.[0].rendererMiB),
    metric('Renderer RSS at end, MiB', (r) => r.longSession?.memory?.at(-1).rendererMiB),
    metric('Renderer RSS peak, MiB', (r) => (r.longSession?.memory ? Math.max(...r.longSession.memory.map((m) => m.rendererMiB)) : null)),
    metric('Renderer RSS after 60 s idle, MiB', (r) => r.longSession?.afterIdle?.rendererMiB),
    metric('Renderer RSS after a memory-pressure signal, MiB', (r) => r.longSession?.afterPressure?.rendererMiB),
    metric('GPU RSS at end, MiB', (r) => r.longSession?.memory?.at(-1).gpuMiB),
    metric('<video> elements at end', (r) => r.longSession?.memory?.at(-1).videos, 0),
    metric('Live media players at end', (r) => r.longSession?.memory?.at(-1).mediaPlayersLive, 0)
  )
}
const sweeps = runs.flatMap((r) => (r.seekSweep ?? []).map((x) => ({ ...x, build: r.build })))
if (sweeps.length) {
  lines.push('', '### Paused seek from script, by distance after a keyframe (ms to the target frame)', '', '| Clip | Seconds after keyframe | Build | Median [min–max] |', '|---|---:|---|---:|')
  for (const clip of [...new Set(sweeps.map((x) => x.clip))])
    for (const after of [...new Set(sweeps.map((x) => x.after))])
      for (const b of builds) {
        const st = stat(sweeps.filter((x) => x.clip === clip && x.after === after && x.build === b).map((x) => x.ms))
        if (st.n) lines.push(`| ${clip} | ${after} | ${b} | ${fmt(st)} |`)
      }
}
const loads = runs.flatMap((r) => [...r.loads.map((l) => l.load[0]), ...r.playback.flatMap((p) => p.samples.map((s) => s.load[0]))])
lines.push('', `1-minute load across all recorded readings: ${Math.min(...loads).toFixed(2)}–${Math.max(...loads).toFixed(2)} (median ${median(loads).toFixed(2)}). Playback windows discarded for load over ${manifest.maxLoad}: ${sum(runs.map((r) => r.discarded.length))}.`)
lines.push(`Runs whose app did not quit within 20 s (cleanup stopped them): ${builds.map((b) => `${b} ${byBuild(b).filter((r) => r.errors.some(closeTimeout)).length}`).join(', ')}.`)
lines.push(`Video decoders reported by Chromium: ${builds.map((b) => `${b}: ${JSON.stringify(Object.assign({}, ...byBuild(b).map((r) => r.decoders ?? {})))}`).join('; ')}.`)
writeFileSync(join(output, 'tables.md'), lines.join('\n') + '\n')
writeFileSync(join(output, 'summary.json'), JSON.stringify({ builds, rows, loads: { min: Math.min(...loads), max: Math.max(...loads), median: median(loads) } }, null, 2) + '\n')
console.log(lines.join('\n'))
