import { expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { executeTool, loadProject, newToolState, StyleStore, ToolContext, AgentEvent } from '../src';
import { saveProject, validateProject } from '../src/project';
import { FakeHost, makeProject } from './helpers';

async function setup() {
  const { root, dir } = await makeProject();
  const events: AgentEvent[] = [];
  const host = new FakeHost(root);
  const ctx: ToolContext = { projectDir: dir, host, style: new StyleStore(() => root),
    emit: (e) => events.push(e), state: newToolState(), supportsImages: false };
  return { ctx, host, dir, events };
}

it('persists an explicit seed and logs a generated seed with the selected preset', async () => {
  const { ctx, dir, events } = await setup();
  const explicit = await executeTool(ctx, 'set_cut_style', { preset: 'clean', seed: -7 });
  expect(explicit.isError).toBe(false);
  expect((await loadProject(dir)).cutStyle).toEqual({ preset: 'clean', seed: -7 });
  const generated = await executeTool(ctx, 'set_cut_style', { preset: 'hyper' });
  expect(generated.isError).toBe(false);
  const style = (await loadProject(dir)).cutStyle;
  expect(style).toEqual({ preset: 'hyper', seed: expect.any(Number) });
  expect(Number.isInteger(style?.seed)).toBe(true);
  expect(JSON.parse(generated.content).cutStyle).toEqual(style);
  const view = JSON.parse((await executeTool(ctx, 'get_project', {})).content);
  expect(view.cutStyle).toEqual(style);
  expect(view.cutStyleSettings).toMatchObject({ secondsPerVisualChange: [1.5, 3], smashes: 2 });
  expect(JSON.parse(generated.content).settings).toEqual(view.cutStyleSettings);
  expect(events).toContainEqual({ type: 'tool', name: 'set_cut_style', summary: `Set cut style to hyper (seed ${style?.seed})` });
});

it('rejects invalid persisted presets and non-integer seeds', async () => {
  const { dir } = await setup();
  const p = await loadProject(dir);
  expect(validateProject({ ...p, cutStyle: { preset: 'unknown', seed: 1 } }).join(' ')).toMatch(/cutStyle.preset/);
  expect(validateProject({ ...p, cutStyle: { preset: 'clean', seed: 1.5 } }).join(' ')).toMatch(/cutStyle.seed/);
  expect(validateProject({ ...p, cutStyle: { preset: 'toString', seed: 1 } }).join(' ')).toMatch(/cutStyle.preset/);
});

it.each([
  ['clean', 8, 'out of band'],
  ['standard', 8, 'in band'],
  ['standard', 11, 'out of band'],
  ['hyper', 11, 'in band'],
  ['punchline', 0, 'not applicable'],
])('reports %s cadence for %s changes in 30 seconds as %s', async (preset, count, verdict) => {
  const { ctx, host } = await setup();
  const p = await loadProject(ctx.projectDir);
  p.cutStyle = { preset, seed: 42 };
  await saveProject(ctx.projectDir, p);
  host.renderExtra = { duration: 30, visualChanges: {
    overall: { seconds: 30, cuts: count, brollStarts: 0, zoomStarts: 0, total: count, perMinute: count * 2 },
    first5: { seconds: 5, cuts: 0, brollStarts: 0, zoomStarts: 0, total: 0, perMinute: 0 },
    first30: { seconds: 30, cuts: count, brollStarts: 0, zoomStarts: 0, total: count, perMinute: count * 2 },
  } };
  const result = await executeTool(ctx, 'render_draft', {});
  expect(result.isError).toBe(false);
  const meter = JSON.parse(result.content).visualChanges;
  expect(meter.overall).toMatchObject({ total: count, perMinute: count * 2, verdict });
  expect(meter.first5.verdict).toBe(preset === 'punchline' ? 'not applicable' : 'out of band');
  expect(meter.first30.verdict).toBe(verdict);
});

it('keeps an old project unchanged and applies no style verdict', async () => {
  const { ctx, host, dir } = await setup();
  const before = await loadProject(dir);
  host.renderExtra = { visualChanges: { overall: { seconds: 12.3, cuts: 0, brollStarts: 0, zoomStarts: 0, total: 0, perMinute: 0 }, first5: { seconds: 5, cuts: 0, brollStarts: 0, zoomStarts: 0, total: 0, perMinute: 0 }, first30: { seconds: 12.3, cuts: 0, brollStarts: 0, zoomStarts: 0, total: 0, perMinute: 0 } } };
  const result = JSON.parse((await executeTool(ctx, 'render_draft', {})).content);
  expect(result.visualChanges.overall.verdict).toBeUndefined();
  await saveProject(dir, await loadProject(dir));
  const after = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8'));
  expect(after).not.toHaveProperty('cutStyle');
  expect({ ...after, updatedAt: before.updatedAt }).toEqual(before);
});

it('returns the current cadence verdict after rendering a changed style', async () => {
  const { ctx, host } = await setup();
  const row = { seconds: 5, cuts: 1, brollStarts: 0, zoomStarts: 0, total: 1, perMinute: 12 };
  host.renderExtra = { visualChanges: { overall: row, first5: row, first30: row } };
  await executeTool(ctx, 'render_draft', {});
  await executeTool(ctx, 'set_cut_style', { preset: 'punchline', seed: 1 });
  const result = JSON.parse((await executeTool(ctx, 'render_draft', {})).content);
  expect(result.skipped).toBeUndefined();
  expect(result.visualChanges.overall.verdict).toBe('not applicable');
  expect(ctx.state.renders).toHaveLength(2);
});
