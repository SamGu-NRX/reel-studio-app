import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StockSearch, StockProvider, StockKind } from '../src/stock';
import { executeTool, newToolState, StyleStore, ToolContext, loadProject } from '../src';
import { discardAssetCandidates } from '../src/tools';
import { FakeHost, makeProject, tinyPng, tmpDir } from './helpers';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
function fixture(provider: StockProvider, kind: StockKind) {
  if (provider === 'pexels') return kind === 'image'
    ? { photos: [{ alt: 'Bread', photographer: 'Baker', url: 'https://www.pexels.com/photo/bread-1/', src: { large: 'https://images.pexels.com/bread.png' } }] }
    : { videos: [{ user: { name: 'Baker' }, url: 'https://www.pexels.com/video/bread-1/', video_files: [{ file_type: 'video/mp4', width: 1280, height: 720, link: 'https://videos.pexels.com/bread.mp4' }] }] };
  if (provider === 'pixabay') return { hits: [{ tags: 'Bread', user: 'Baker', pageURL: 'https://pixabay.com/photos/bread-1/',
    largeImageURL: 'https://cdn.pixabay.com/bread.png', imageURL: 'https://cdn.pixabay.com/requires-approval.png',
    videos: { medium: { url: 'https://cdn.pixabay.com/bread.mp4' } } }] };
  return { results: [{ title: 'Bread', creator: 'Baker', foreign_landing_url: 'https://example.com/bread', url: 'https://example.com/bread.png',
    license: 'by', license_version: '4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' }] };
}
function setup(provider: StockProvider, kind: StockKind, response = fixture(provider, kind)) {
  const settingsDir = tmpDir('stock-settings '); roots.push(settingsDir);
  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    if (provider === 'pexels') expect(new Headers(init?.headers).get('authorization')).toBe('fabricated-key');
    if (provider === 'pixabay') expect(url.searchParams.get('key')).toBe('fabricated-key');
    return Response.json(response);
  };
  const opts = { settingsDir, key: async () => 'fabricated-key', fetchImpl };
  return { opts, requests, search: new StockSearch(opts) };
}

describe('stock providers', () => {
  it.each<[StockProvider, StockKind, string, string]>([
    ['pexels', 'image', '/v1/search', 'Pexels License'], ['pexels', 'video', '/v1/videos/search', 'Pexels License'],
    ['pixabay', 'image', '/api/', 'Pixabay Content License'], ['pixabay', 'video', '/api/videos/', 'Pixabay Content License'],
    ['openverse', 'image', '/v1/images/', 'CC BY 4.0'],
  ])('fails if %s %s loses its source or licence', async (provider, kind, endpoint, license) => {
    const { search, requests } = setup(provider, kind);
    const { results } = await search.search(kind, 'bread & butter', provider);
    expect(results).toEqual([expect.objectContaining({ provider, creator: 'Baker', license, attribution: expect.stringContaining('Baker'),
      url: expect.stringContaining(kind === 'video' ? 'bread.mp4' : 'bread.png'), source: expect.stringContaining('https://') })]);
    expect(requests[0].pathname).toBe(endpoint);
    expect(requests[0].searchParams.get(provider === 'pexels' ? 'query' : 'q')).toBe('bread & butter');
  });

  it('fails if a missing key causes a request or hides keyless Openverse', async () => {
    const { opts, requests } = setup('openverse', 'image');
    const search = new StockSearch({ ...opts, key: async () => null });
    const result = await search.search('image', 'bread');
    expect(result.results.map(r => r.provider)).toEqual(['openverse']);
    expect(result.notes).toEqual([]);
    expect(requests.map(r => r.hostname)).toEqual(['api.openverse.org']);
  });

  it('fails if Pixabay repeats a query before 24 hours, including after restart, or keeps expired responses', async () => {
    const { opts, requests } = setup('pixabay', 'image');
    let time = Date.UTC(2026, 9, 23);
    const first = new StockSearch({ ...opts, now: () => time });
    const expected = (await first.search('image', 'bread', 'pixabay')).results;
    expect(expected).toHaveLength(1);
    time += 24 * 60 * 60 * 1000 - 1;
    const restarted = new StockSearch({ ...opts, now: () => time });
    expect((await restarted.search('image', 'bread', 'pixabay')).results).toEqual(expected);
    expect(requests).toHaveLength(1);
    time += 1;
    expect((await restarted.search('image', 'bread', 'pixabay')).results).toEqual(expected);
    expect(requests).toHaveLength(2);
  });

  it('fails if a 429 is retried during Retry-After or its backoff disappears on restart', async () => {
    const { opts } = setup('pexels', 'image');
    let time = Date.UTC(2026, 9, 23), attempts = 0;
    const options = { ...opts, now: () => time, fetchImpl: async () => {
      attempts++;
      return attempts === 1 ? new Response('key must never escape', { status: 429, headers: { 'retry-after': '120' } }) : Response.json(fixture('pexels', 'image'));
    } };
    const first = await new StockSearch(options).search('image', 'bread', 'pexels');
    expect(first.notes.join(' ')).toMatch(/rate limit/i);
    time += 119_999;
    expect((await new StockSearch(options).search('image', 'other', 'pexels')).results).toEqual([]);
    expect(attempts).toBe(1);
    time++;
    expect((await new StockSearch(options).search('image', 'bread', 'pexels')).results).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it('fails if unknown, noncommercial or no-derivatives Openverse licences are offered as safe', async () => {
    const good = fixture('openverse', 'image').results![0];
    const { search } = setup('openverse', 'image', { results: [good, ...['by-nc', 'by-nd', 'custom'].map(license => ({ ...good, license })),
      { ...good, license_url: 'https://example.com/not-a-license' }] });
    expect((await search.search('image', 'bread', 'openverse')).results).toHaveLength(1);
  });

  it('fails if provider errors echo credentials from request URLs or response bodies', async () => {
    const { opts } = setup('pixabay', 'image');
    const search = new StockSearch({ ...opts, fetchImpl: async input => { throw new Error(String(input)); } });
    const result = await search.search('image', 'bread', 'pixabay');
    expect(result.notes.join(' ')).toMatch(/Pixabay/);
    expect(JSON.stringify(result)).not.toContain('fabricated-key');
  });

  it.each<StockProvider>(['pexels', 'openverse'])('fails if %s candidates bypass freezing, lose ledger provenance, or omit caption attribution', async (provider) => {
    const { root, dir } = await makeProject(); roots.push(root);
    const { search } = setup(provider, 'image');
    const host = new FakeHost(root); host.engineAssets = true;
    const ctx: ToolContext = { projectDir: dir, host, style: new StyleStore(() => root), emit: () => {}, state: newToolState(), supportsImages: true,
      stockSearch: search };
    const found = await executeTool(ctx, 'resolve_asset', { kind: 'image', intent: 'bread photo', provider });
    expect(found.isError, found.content).toBe(false);
    const candidate = JSON.parse(found.content).candidates[0];
    expect(candidate.provider).toBe(provider);
    expect(candidate.previewPath).toMatch(/^work\/thumbs\//);
    const committed = await executeTool(ctx, 'resolve_asset', { kind: 'image', intent: 'bread photo', phase: 'commit', candidateId: candidate.id });
    expect(committed.isError, committed.content).toBe(false);
    const asset = JSON.parse(committed.content).asset;
    expect(asset.committedPath).toMatch(/^work\/assets\/frozen\/image\//);
    expect(await fs.readFile(path.join(dir, asset.committedPath))).toEqual(tinyPng());
    const record = JSON.parse(await fs.readFile(path.join(dir, 'work/assets/manifest.jsonl'), 'utf8'));
    expect(record).toMatchObject({ license: provider === 'pexels' ? 'Pexels License' : 'CC BY 4.0', creator: 'Baker', provenance: { provider, sourceUrl: provider === 'pexels' ? 'https://images.pexels.com/bread.png' : 'https://example.com/bread.png' } });
    expect((await executeTool(ctx, 'add_broll', { anchor: { from: 'w29', to: 'w30' }, treatment: 'side-card', asset: asset.assetId, params: {} })).isError).toBe(false);
    expect((await executeTool(ctx, 'write_post', { caption: 'Bread takes patience', hashtags: ['a', 'b', 'c', 'd', 'e'], keywords: ['bread'] })).isError).toBe(false);
    expect((await loadProject(dir)).post.caption).toContain(provider === 'pexels' ? 'Baker on Pexels' : 'Baker on Openverse');
  });
});

it('fails if stock footage loses its preview, frozen bytes, or cancellation cleanup', async () => {
  const { root, dir } = await makeProject(); roots.push(root);
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(20)]);
  class VideoHost extends FakeHost {
    failDownload = false;
    override async runEngine(command: string, args: string[]) {
      if (command !== 'download-media') return super.runEngine(command, args);
      const name = args[args.indexOf('--name') + 1];
      await fs.mkdir(path.join(dir, 'work/assets'), { recursive: true });
      if (this.failDownload) {
        await fs.writeFile(path.join(dir, `work/assets/${name}.mp4.part`), bytes);
        throw new Error('download cancelled');
      }
      expect(args).toContain('--to-project');
      const asset = `work/assets/${name}.mp4`;
      await fs.writeFile(path.join(dir, asset), bytes);
      return { asset };
    }
  }
  const host = new VideoHost(root);
  const { search } = setup('pixabay', 'video');
  const ctx: ToolContext = { projectDir: dir, host, style: new StyleStore(() => root), emit: () => {}, state: newToolState(), supportsImages: true, stockSearch: search };
  const found = await executeTool(ctx, 'resolve_asset', { kind: 'video', intent: 'bread', provider: 'pixabay' });
  expect(found.isError, found.content).toBe(false);
  const candidate = JSON.parse(found.content).candidates[0];
  expect(candidate).toMatchObject({ kind: 'video', provider: 'pixabay', durationSec: 2, license: 'Pixabay Content License' });
  const committed = await executeTool(ctx, 'resolve_asset', { kind: 'video', intent: 'bread', phase: 'commit', candidateId: candidate.id });
  expect(committed.isError, committed.content).toBe(false);
  const asset = JSON.parse(committed.content).asset;
  expect(await fs.readFile(path.join(dir, asset.committedPath))).toEqual(bytes);
  expect((await executeTool(ctx, 'add_broll', { anchor: { from: 'w29', to: 'w30' }, treatment: 'side-card', asset: asset.assetId, params: {} })).isError).toBe(false);
  expect((await loadProject(dir)).broll[0].asset).toBe(asset.committedPath);
  await discardAssetCandidates(ctx);
  host.failDownload = true;
  const again = await executeTool(ctx, 'resolve_asset', { kind: 'video', intent: 'other bread', provider: 'pixabay' });
  expect(JSON.parse(again.content).candidates).toEqual([]);
  expect((await fs.readdir(path.join(dir, 'work/assets'))).filter(f => f.endsWith('.part'))).toEqual([]);
});

it.each<[StockProvider, number, number]>([['pexels', 200, 3_600_000], ['pixabay', 100, 60_000]])('fails if %s exceeds its published request limit', async (provider, limit, windowMs) => {
  const { opts, requests } = setup(provider, 'image');
  let time = Date.UTC(2026, 9, 23);
  const search = new StockSearch({ ...opts, now: () => time });
  for (let n = 0; n < limit; n++) expect((await search.search('image', `bread ${n}`, provider)).results).toHaveLength(1);
  expect((await search.search('image', 'another query', provider)).notes.join(' ')).toMatch(/rate limit/);
  expect(requests).toHaveLength(limit);
  time += windowMs;
  expect((await search.search('image', 'another query', provider)).results).toHaveLength(1);
});
