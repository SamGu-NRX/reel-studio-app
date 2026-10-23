import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { executeTool, newToolState, type ToolContext } from '../src/tools';
import { StyleStore } from '../src/style';

const exec = promisify(execFile);
const engine = resolve(__dirname, '../../engine');
let root: string;
let ctx: ToolContext;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'footage-tool-'));
  const uvArgs = ['run', '--no-project', '--python', '3.11', '--with-editable', `${engine}[dev]`, 'python'];
  await exec('uv', [...uvArgs, join(__dirname, 'fixtures/index-footage.py'), root], { cwd: engine });
  ctx = { projectDir: join(root, 'Projects/test'), host: {
    reelStudioRoot: () => root,
    renderAnimation: async () => { throw new Error('Search must not render'); },
    async runEngine(command, args, _progress, signal) {
      const { stdout } = await exec('uv', [...uvArgs, '-m', 'reelengine', command, ...args], { cwd: engine, signal });
      const events: unknown[] = stdout.trim().split('\n').map((line) => JSON.parse(line));
      for (const event of events) {
        if (event && typeof event === 'object' && 'event' in event && event.event === 'done' && 'result' in event) return event.result;
      }
      throw new Error('Engine returned no result');
    },
  },
    style: new StyleStore(() => root), emit: () => {}, state: newToolState(), supportsImages: true };
}, 60000);
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

it('finds indexed speech through search_footage without loading a project transcript', async () => {
  const result = await executeTool(ctx, 'search_footage', { query: 'twenty bucks', limit: 1 });
  expect(result.isError, result.content).toBe(false);
  expect(JSON.parse(result.content)).toMatchObject({ hits: [{ file: { path: 'Library/take.mp4' },
    t0: 0, t1: 2, said: 'twenty bucks.', thumbnail: expect.stringMatching(/\.index.*\.jpg$/) }], more: false });
  expect(result.images).toMatchObject([{ mime: 'image/jpeg', base64: expect.any(String) }]);
  expect(ctx.state.changed.size).toBe(0);
  expect((await executeTool(ctx, 'search_footage', { query: '', limit: 1 })).isError).toBe(true);
  expect((await executeTool(ctx, 'search_footage', { query: 'twenty', limit: 9 })).isError).toBe(true);
});
