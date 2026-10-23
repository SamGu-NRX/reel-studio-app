import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createAI, executeTool, loadProject, newToolState, PythonEngineHost, saveProject, StyleStore, ToolContext, validateProject } from '../src';
import { FakeHost, makeProject, ScriptedModel, call, tmpDir } from './helpers';

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true }))); });

it('set_clips refuses invalid items without changing the saved cut, then saves mixed items in order', async () => {
  const { root, dir } = await makeProject();
  folders.push(root);
  const ctx: ToolContext = { projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root), emit: () => undefined, state: newToolState(), supportsImages: false };
  const p = await loadProject(dir);
  p.sources.push({ id: 's2', path: 'media/silent.mp4', duration: 4, fps: 30 });
  await saveProject(dir, p);
  const before = await fs.readFile(path.join(dir, 'project.json'), 'utf8');
  for (const item of [
    { source: 'missing', in: 0, out: 1 },
    { source: 's2', in: -1, out: 1 },
    { source: 's2', in: 1, out: 5 },
    { source: 's2', in: 2, out: 2 },
    { source: 's2', in: 3, out: 2 },
    { source: 's2', in: 0, out: 0.001 },
    { source: 's2', in: 0, out: 1 / 60 },
    { source: 's2', in: 0, out: Infinity },
    { source: 's2', in: NaN, out: 1 },
    { from: 'w9', to: 'w0' },
    { from: 'w0', to: 'w999' },
    { source: 's2', in: 0, out: 1, from: 'w0', to: 'w1' },
  ]) {
    const result = await executeTool(ctx, 'set_clips', { items: [item] });
    expect(result.isError).toBe(true);
    expect(result.content).not.toMatch(/unknown tool/);
    expect(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).toBe(before);
  }
  expect((await executeTool(ctx, 'set_clips', { items: [] })).isError).toBe(true);
  const items = [{ source: 's2', in: 1, out: 3 }, { from: 'w0', to: 'w1' }, { source: 's1', in: 20, out: 21 }];
  const result = await executeTool(ctx, 'set_clips', { items });
  expect(result.isError, result.content).toBe(false);
  const saved = (await loadProject(dir)).cut.keep;
  expect(saved).toEqual([{ clip: 'c1', ...items[0] }, items[1], { clip: 'c2', ...items[2] }]);
  expect(JSON.parse(result.content).approxDurationSec).toBeGreaterThan(3);
  expect((await executeTool(ctx, 'set_clips', { items: [items[2], items[0], items[1]] })).isError).toBe(false);
  expect((await loadProject(dir)).cut.keep).toEqual([saved[2], saved[0], saved[1]]);
  const halfFrameStart = await executeTool(ctx, 'set_clips', { items: [{ source: 's2', in: 1 / 60, out: 1 / 30 }] });
  expect(halfFrameStart.isError, halfFrameStart.content).toBe(false);
});

const python = process.env.REELSTUDIO_TEST_PYTHON;
describe.skipIf(!python)('multi-source first edit through the real engine', () => {
  it.each([false, true])('plans and renders several clips, all silent = %s', async (allSilent) => {
    const root = tmpDir(); folders.push(root);
    const dir = path.join(root, 'Projects', 'reel');
    const input = path.join(root, 'inputs'); await fs.mkdir(input);
    const files = [0, 1, 2].map((i) => path.join(input, `clip${i}.mp4`));
    for (const [i, file] of files.entries()) {
      execFileSync(process.env.REELENGINE_FFMPEG ?? 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${['white', 'gray', 'orange'][i]}:s=96x64:r=30:d=2`,
        ...(!allSilent && i !== 1 ? ['-f', 'lavfi', '-i', 'sine=f=440:r=48000:d=2', '-c:a', 'aac'] : []),
        '-c:v', 'libx264', '-preset', 'ultrafast', file]);
    }
    const host = new PythonEngineHost({ python, cwd: path.resolve(__dirname, '../../engine'), root });
    await host.runEngine('init', ['--project', dir, '--title', 'Clip reel', ...files]);
    const p = await loadProject(dir); p.format = { width: 96, height: 64, fps: 30 }; p.captions.enabled = false;
    await saveProject(dir, p);
    if (!allSilent) {
      await fs.writeFile(path.join(dir, 'work/transcript.json'), JSON.stringify({ words: [{ id: 'w0', source: 's1', s: 0.2, e: 0.6, w: 'Hook', p: 1 }, { id: 'w1', source: 's3', s: 0.2, e: 0.6, w: 'End', p: 1 }] }));
      await fs.writeFile(path.join(dir, 'work/analysis.json'), JSON.stringify({ retakes: [], pauses: [] }));
    }
    const model = new ScriptedModel([
      (request) => {
        expect(JSON.stringify(request.messages)).toMatch(/many clips/i);
        return { toolCalls: [call('list_sources')] };
      },
      (request) => {
        const reply = request.messages.findLast((message) => message.role === 'tool');
        if (reply?.role !== 'tool') throw new Error('Expected the source catalog');
        const catalog = reply.results.find((result) => result.name === 'list_sources');
        expect(catalog?.isError, catalog?.content).toBe(false);
        const sources = JSON.parse(catalog!.content).sources;
        expect(sources.map((source: { id: string; hasVoice: boolean }) => [source.id, source.hasVoice])).toEqual([['s1', !allSilent], ['s2', false], ['s3', !allSilent]]);
        expect(sources.every((source: { keyframes: unknown[] }) => source.keyframes.length === 3)).toBe(true);
        expect(catalog?.images).toHaveLength(9);
        expect(sources[0].transcriptHead).toBe(allSilent ? '' : 'Hook');
        return { toolCalls: [call('set_clips', { items: [{ source: 's3', in: 0, out: 1 }, { source: 's2', in: 0.5, out: 1.5 }, ...(allSilent ? [{ source: 's1', in: 0, out: 1 }] : [{ from: 'w0', to: 'w0' }])] })] };
      },
      { toolCalls: [call('render_draft')] },
      { toolCalls: [call('write_post', { caption: 'A clip reel.', hashtags: ['clips', 'reel', 'video', 'story', 'moments'], keywords: ['clips'] }), call('finish', { summary_for_user: 'I put your clips in story order.' })] },
    ]);
    const ai = createAI({ host, settingsDir: path.join(root, 'settings'), providerOverride: model });
    const result = await ai.firstEdit(dir, () => undefined);
    expect(result.version).toBe(1);
    expect(result.changed).toContain('cut');
    expect((await loadProject(dir)).cut.keep.slice(0, 2)).toEqual([{ clip: 'c1', source: 's3', in: 0, out: 1 }, { clip: 'c2', source: 's2', in: 0.5, out: 1.5 }]);
    const rendered = path.join(dir, 'versions/v1/export.mp4');
    const verification = await host.runEngine('verify', [rendered]);
    expect(verification.ok, JSON.stringify(verification)).toBe(true);
    const probe = await host.runEngine('probe', [rendered]);
    expect(probe.duration).toBeCloseTo(allSilent ? 3 : 2.9, 1);
    if (allSilent) {
      const simpleDir = path.join(root, 'Projects', 'simple');
      await host.runEngine('init', ['--project', simpleDir, '--title', 'Simple reel', ...files]);
      const simpleProject = await loadProject(simpleDir);
      simpleProject.format = { width: 96, height: 64, fps: 30 };
      await saveProject(simpleDir, simpleProject);
      const simpleAI = createAI({ host, settingsDir: path.join(root, 'simple-settings') });
      await simpleAI.setActive('none');
      await simpleAI.firstEdit(simpleDir, () => undefined);
      expect((await loadProject(simpleDir)).cut.keep).toEqual([
        { clip: 'c1', source: 's1', in: 0, out: 2 },
        { clip: 'c2', source: 's2', in: 0, out: 2 },
        { clip: 'c3', source: 's3', in: 0, out: 2 },
      ]);
      expect((await host.runEngine('verify', [path.join(simpleDir, 'versions/v1/export.mp4')])).ok).toBe(true);
    }
  }, 120_000);
});

// #72's sound effects land on cuts; a word range right after a clip from another source starts on one
it('set_sfx takes the cut into a word range that follows a clip', async () => {
  const { root, dir } = await makeProject();
  folders.push(root);
  const ctx: ToolContext = { projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root), emit: () => undefined, state: newToolState(), supportsImages: false };
  const p = await loadProject(dir);
  p.sources.push({ id: 's2', path: 'media/silent.mp4', duration: 4, fps: 30 });
  await saveProject(dir, p);
  expect((await executeTool(ctx, 'set_clips', { items: [{ source: 's2', in: 1, out: 3 }, { from: 'w0', to: 'w1' }] })).isError).toBe(false);
  const r = await executeTool(ctx, 'set_sfx', { sfx: [{ at: { cut: 'w0' }, sound: 'whoosh-quick' }] });
  expect(r.isError, String(r.content)).toBe(false);
});

// a join bridges two spoken ranges: after a clip there is none, and the engine plays a hard cut, so the AI must
// never save one and then claim a J-cut
it('refuses a join on the word range right after a clip, and keeps one between two word ranges', async () => {
  const { root, dir } = await makeProject();
  folders.push(root);
  const p = await loadProject(dir);
  p.sources.push({ id: 's2', path: 'media/silent.mp4', duration: 4, fps: 30 });
  const join = { transition: 'j' as const, frames: 6 };
  p.cut.keep = [{ clip: 'c1', source: 's2', in: 1, out: 3 }, { from: 'w0', to: 'w1', join }];
  expect(validateProject(p)).toContain('cut.keep[1].join: not allowed right after a clip');
  p.cut.keep = [{ clip: 'c1', source: 's2', in: 1, out: 3 }, { from: 'w0', to: 'w1' }, { from: 'w3', to: 'w4', join }];
  expect(validateProject(p)).toEqual([]);
});

