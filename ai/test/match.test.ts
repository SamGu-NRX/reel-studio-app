import { describe, it, expect } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { approxDuration, approxOutputTimes, keptWords, validateProject, withDefaults, executeTool, newToolState, loadProject, saveProject, StyleStore, ToolContext } from '../src';
import { briefText, MATCH_TOOLS } from '../src/editor';
import { FakeHost, makeProject, makeTranscript } from './helpers';

// A seconds range plays its whole span (engine/reelengine/cut.py); these pin the planning mirror of it.
describe('seconds ranges in cut.keep', () => {
  // w0..w2 at 0.1-1.16, then a 0.98 s pause, w3..w5 at 2.14-3.2
  const t = makeTranscript(['one two three', 'four five six']);

  it('keep the words whose midpoint lies inside, on the output clock, with no pause capped', () => {
    const keep = [{ source: 's1', start: 1.5, end: 3.5 }, { source: 's1', start: 0, end: 1.2 }];
    expect(keptWords(t, keep).map((w) => w.id)).toEqual(['w3', 'w4', 'w5', 'w0', 'w1', 'w2']);
    const times = approxOutputTimes(t, keep, 0.12);
    expect(times.get('w3')).toEqual({ s: 0.64, e: 0.94 });
    expect(times.get('w0')).toEqual({ s: 2.1, e: 2.4 });
    expect(approxDuration(t, keep, 0.12)).toBe(3.2);
  });

  it('a word half outside a range belongs to the range holding its midpoint', () => {
    expect(keptWords(t, [{ source: 's1', start: 0.5, end: 1.0 }]).map((w) => w.id)).toEqual(['w1']);
    expect(keptWords(t, [{ source: 's2', start: 0, end: 10 }])).toEqual([]);
  });

  it('validate needs start >= 0 and end > start, and accepts mixed lists', () => {
    const p = withDefaults({ cut: { keep: [{ source: 's1', start: 2, end: 1 }, { from: 'w0', to: 'w1' }], gapCap: 0.25 } });
    expect(validateProject(p, t)).toEqual(['cut.keep[0]: a seconds range needs source, start >= 0 and end > start']);
    p.cut.keep[0] = { source: 's1', start: 0, end: 1 };
    expect(validateProject(p, t)).toEqual([]);
  });
});

describe('a match edit', () => {
  async function matchCtx(): Promise<ToolContext> {
    const { root, dir } = await makeProject();
    const p = await loadProject(dir);
    p.cut.keep = [{ source: 's1', start: 0, end: 30 }];
    p.brief = { kind: 'match', match: 'A v B', team: 'B', moment: 'B score', players: [] };
    await saveProject(dir, p);
    return { projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root), emit: () => undefined, state: newToolState(), supportsImages: true, match: true, lookupImpl: async () => ['93.184.215.14'] };
  }

  it.each([
    ['search_images', { query: 'galatasaray photo' }],
    ['fetch_image', { url: 'https://example.com/a.png' }],
    ['capture_website', { url: 'https://example.com' }],
    ['resolve_asset', { kind: 'image', intent: 'https://example.com/a.png' }],
    ['resolve_asset', { kind: 'image', intent: 'fenerbahce stadium' }],
    ['set_cut', { keep: [{ from: 'w0', to: 'w3' }] }],
    ['set_gap_cap', { seconds: 0.12 }],
  ])('refuses %s, so nothing comes from the web and the footage stays as given', async (name, args) => {
    const ctx = await matchCtx();
    const r = await executeTool(ctx, name, args);
    expect(r.isError).toBe(true);
    expect((await loadProject(ctx.projectDir)).cut.keep).toEqual([{ source: 's1', start: 0, end: 30 }]);
  });

  it('leads the hook title on the first kept word in from the first frame', async () => {
    const ctx = await matchCtx();
    const p = await loadProject(ctx.projectDir);
    // the first line ends at 3.44 s and w9 starts the second at 4.42 s: from 3.5 s, w9 plays first, at 0.92 s
    p.cut.keep = [{ source: 's1', start: 3.5, end: 30 }];
    await saveProject(ctx.projectDir, p);
    await executeTool(ctx, 'add_broll', { anchor: { from: 'w9', to: 'w11' }, treatment: 'text-pop', params: { text: 'Hook', style: 'label' } });
    await executeTool(ctx, 'add_broll', { anchor: { from: 'w10', to: 'w11' }, treatment: 'text-pop', params: { text: 'Later', style: 'label' } });
    expect((await loadProject(ctx.projectDir)).broll.map((b) => b.leadIn)).toEqual([0.92, 0.13]);
  });

  it('aims punch-ins at the centre of the frame', async () => {
    const ctx = await matchCtx();
    expect((await executeTool(ctx, 'set_zoom', { zooms: [{ anchor: { from: 'w1', to: 'w3' }, scale: 1.15 }] })).isError).toBe(false);
    expect((await loadProject(ctx.projectDir)).zooms).toEqual([{ anchor: { from: 'w1', to: 'w3' }, scale: 1.15, focus: [0.5, 0.5] }]);
  });

  it('offers no web, music, cut or animation tool', () => {
    for (const t of ['search_images', 'fetch_image', 'capture_website', 'set_cut', 'set_gap_cap', 'choose_music', 'make_animation', 'add_style_rule']) {
      expect(MATCH_TOOLS).not.toContain(t);
    }
  });

  it('puts the brief in a data block with each player and photo', () => {
    const text = briefText({ kind: 'match', match: 'A v B', team: 'B', moment: 'Solanke scores', minute: "90+1'", score: 'A 1-1 B',
      players: [{ name: 'Solanke', team: 'B', role: 'scorer', image: 'Library/Images/Solanke.png' }, { name: 'Tonali', team: 'B' }] });
    expect(text).toBe('<brief_data>\nMatch: A v B\nPosting for: B\nMoment: Solanke scores\nMinute: 90+1\'\nScore after the moment: A 1-1 B\n'
      + 'Players in this moment (the only names and photos you may show):\n- Solanke, B, scorer; photo: Library/Images/Solanke.png\n- Tonali, B; no photo\n</brief_data>');
  });
});

it('a project without a brief is not a match edit', async () => {
  const { dir } = await makeProject();
  const raw = JSON.parse(await fsp.readFile(path.join(dir, 'project.json'), 'utf8'));
  expect(raw.brief).toBeUndefined();
});
