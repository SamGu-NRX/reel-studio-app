import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { executeTool, loadProject, newToolState, StyleStore, type ToolContext } from '../src';
import { saveProject } from '../src/project';
import { FakeHost, makeProject } from './helpers';

const exec = promisify(execFile);
class LintHost extends FakeHost {
  override async runEngine(command: string, args: string[]) {
    if (command !== 'lint-edit' && command !== 'render') return super.runEngine(command, args);
    const { stdout } = await exec('uv', ['run', '--no-project', '--python', '3.11', '--with-editable', './engine[dev]',
      'python', '-m', 'reelengine', command, ...args], { cwd: path.resolve(__dirname, '../..') });
    const messages = stdout.trim().split('\n').map((line) => JSON.parse(line));
    const done = messages.find((message) => message.event === 'done');
    if (!done) throw new Error(stdout);
    return done.result;
  }
}

async function setup() {
  const { root, dir } = await makeProject();
  const p = await loadProject(dir);
  p.format = { width: 160, height: 284, fps: 30 };
  p.sources = [{ id: 's1', path: 'media/take.mp4', duration: 3, fps: 30 }];
  p.cut.keep = [{ from: 'w0', to: 'w2' }];
  p.captions.enabled = false;
  p.zooms = [{ kind: 'snap', scale: 1.3, anchor: { from: 'w1', to: 'w1' }, focus: [.5, .5] }];
  await saveProject(dir, p);
  await fsp.mkdir(path.join(dir, 'media'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'work', 'transcript.json'), JSON.stringify({ words: [
    { id: 'w0', source: 's1', s: 0, e: 1, w: 'One' },
    { id: 'w1', source: 's1', s: 1.1, e: 1.2, w: 'two' },
    { id: 'w2', source: 's1', s: 1.3, e: 2.7, w: 'three.' },
  ] }));
  const ctx: ToolContext = { projectDir: dir, host: new LintHost(root), style: new StyleStore(() => root),
    emit: () => {}, state: newToolState(), supportsImages: false };
  return { ctx, dir };
}

it('lint_edit exposes actual engine issues and repairs without mutating the edit', async () => {
  const { ctx, dir } = await setup();
  const before = await loadProject(dir);
  const output = await executeTool(ctx, 'lint_edit', {});
  expect(output.isError, output.content).toBe(false);
  const result = JSON.parse(output.content);
  expect(result.fixed).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'zoom-ramp' })]));
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'visual-dwell' })]));
  expect(await loadProject(dir)).toEqual(before);
});

it('render_draft returns real lint issues and applied repairs beside the meter, including a skipped preview', async () => {
  const { ctx, dir } = await setup();
  await exec(process.env.REELENGINE_FFMPEG ?? 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=160x284:r=30:d=3',
    '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', path.join(dir, 'media/take.mp4')]);
  const output = await executeTool(ctx, 'render_draft', {});
  expect(output.isError, output.content).toBe(false);
  const result = JSON.parse(output.content);
  expect(result.visualChanges.overall.seconds).toBeGreaterThan(2);
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'visual-dwell' })]));
  expect(result.fixed).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'zoom-ramp' })]));
  const post = await executeTool(ctx, 'write_post', { caption: 'One two three', hashtags: ['one', 'two', 'three', 'four', 'five'], keywords: [] });
  expect(post.isError, post.content).toBe(false);
  const skipped = JSON.parse((await executeTool(ctx, 'render_draft', {})).content);
  expect(skipped.skipped).toBeDefined();
  expect(skipped.issues).toEqual(result.issues);
  expect(skipped.fixed).toEqual(result.fixed);
});
