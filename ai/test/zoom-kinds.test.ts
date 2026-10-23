import { expect, it } from 'vitest';
import { executeTool, loadProject, newToolState, StyleStore, type ToolContext } from '../src';
import { FakeHost, makeProject } from './helpers';

it('set_zoom saves every named kind and rejects an unknown kind without changing the project', async () => {
  const { root, dir } = await makeProject();
  const ctx: ToolContext = { projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root),
    emit: () => {}, state: newToolState(), supportsImages: true };
  const zooms = ['punch', 'snap', 'drift'].map((kind) => ({
    kind, anchor: { from: 'w16', to: 'w26' }, scale: 1.2,
  }));
  const ok = await executeTool(ctx, 'set_zoom', { zooms });
  expect(ok.isError, ok.content).toBe(false);
  expect((await loadProject(dir)).zooms).toEqual(zooms);
  const bad = await executeTool(ctx, 'set_zoom', { zooms: [{ ...zooms[0], kind: 'spin' }] });
  expect(bad.isError).toBe(true);
  expect(bad.content).toMatch(/kind.*must be one of punch, snap, drift/);
  expect((await loadProject(dir)).zooms).toEqual(zooms);
});

it('set_zoom leaves named scale defaults to the engine and preserves legacy calls', async () => {
  const { root, dir } = await makeProject();
  const ctx: ToolContext = { projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root),
    emit: () => {}, state: newToolState(), supportsImages: true };
  const anchor = { from: 'w16', to: 'w26' };
  const result = await executeTool(ctx, 'set_zoom', { zooms: [{ kind: 'drift', anchor }] });
  expect(result.isError, result.content).toBe(false);
  expect((await loadProject(dir)).zooms).toEqual([{ kind: 'drift', anchor }]);
  const legacy = [{ anchor, scale: 1.12 }, { anchor, scale: 1.2, style: 'snap' }];
  expect((await executeTool(ctx, 'set_zoom', { zooms: legacy })).isError).toBe(false);
  expect((await loadProject(dir)).zooms).toEqual(legacy);
});
