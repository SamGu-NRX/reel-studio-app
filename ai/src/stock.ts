import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFileAtomic } from './project';

export type StockProvider = 'pexels' | 'pixabay' | 'openverse';
export type StockKind = 'image' | 'video';
export interface StockResult {
  provider: StockProvider; title: string; url: string; source: string; creator: string;
  license: string; licenseUrl: string; attributionRequired: boolean; attribution: string;
}
export interface StockOptions {
  settingsDir: string; key: (provider: 'pexels' | 'pixabay') => Promise<string | null>;
  fetchImpl?: typeof fetch; now?: () => number;
}
const DAY = 86_400_000;
const LABELS = { pexels: 'Pexels', pixabay: 'Pixabay', openverse: 'Openverse' };
const queues = new Map<string, Promise<unknown>>();
function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const rows = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
function https(v: unknown): string {
  try { const u = new URL(str(v)); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; }
  catch { return ''; }
}
function mapResults(raw: unknown, provider: StockProvider, kind: StockKind): StockResult[] {
  const data = record(raw);
  const items = rows(provider === 'pexels' ? data[kind === 'video' ? 'videos' : 'photos'] : provider === 'pixabay' ? data.hits : data.results);
  return items.slice(0, 20).flatMap((item): StockResult[] => {
    const x = record(item);
    let url: string, source: string, creator: string, license: string, licenseUrl: string, title: string;
    let attributionRequired = true;
    if (provider === 'pexels') {
      const files = rows(x.video_files).map(record).filter(f => f.file_type === 'video/mp4' && typeof f.height === 'number' && f.height <= 1080);
      files.sort((a, b) => Number(b.height) - Number(a.height));
      url = https(kind === 'video' ? files[0]?.link : record(x.src).large);
      source = https(x.url); creator = str(kind === 'video' ? record(x.user).name : x.photographer);
      title = str(x.alt) || 'Stock footage'; license = 'Pexels License'; licenseUrl = 'https://www.pexels.com/license/';
    } else if (provider === 'pixabay') {
      url = https(kind === 'video' ? record(record(x.videos).medium).url : x.largeImageURL);
      source = https(x.pageURL); creator = str(x.user); title = str(x.tags);
      license = 'Pixabay Content License'; licenseUrl = 'https://pixabay.com/service/license-summary/';
      // The API asks us to identify Pixabay wherever results appear; keep that credit with the export too.
    } else {
      const code = str(x.license).toLowerCase(), version = str(x.license_version);
      // Share-alike needs an export licensing choice the editor does not offer.
      // NC and ND do not cover commercial, edited output. Unknown licences are refused.
      if (!['by', 'cc0', 'pdm'].includes(code)) return [];
      const expected = code === 'by' && ['1.0', '2.0', '2.5', '3.0', '4.0'].includes(version)
        ? `https://creativecommons.org/licenses/by/${version}/`
        : code === 'cc0' && version === '1.0' ? 'https://creativecommons.org/publicdomain/zero/1.0/'
          : code === 'pdm' && version === '1.0' ? 'https://creativecommons.org/publicdomain/mark/1.0/' : '';
      if (!expected || https(x.license_url) !== expected) return [];
      licenseUrl = expected; license = code === 'by' ? `CC BY ${version}` : code === 'cc0' ? 'CC0 1.0' : 'Public Domain Mark 1.0';
      attributionRequired = code === 'by';
      url = https(x.url); source = https(x.foreign_landing_url); creator = str(x.creator); title = str(x.title);
    }
    if (!url || !source || !creator) return [];
    const attribution = `${title || 'Stock footage'} by ${creator} on ${LABELS[provider]} (${source}), ${license} (${licenseUrl}). Cropped or edited for this video.`;
    return [{ provider, title: title || 'Stock footage', url, source, creator, license, licenseUrl, attributionRequired, attribution }];
  }).slice(0, 3);
}
interface RateState { requests: number[]; blockedUntil: number; failures: number }
async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e instanceof SyntaxError || (e instanceof Error && 'code' in e && e.code === 'ENOENT')) return null; throw e; }
}
function rateState(raw: unknown): RateState {
  const x = record(raw);
  return { requests: rows(x.requests).filter((t): t is number => typeof t === 'number' && Number.isFinite(t)),
    blockedUntil: typeof x.blockedUntil === 'number' && Number.isFinite(x.blockedUntil) ? x.blockedUntil : 0,
    failures: typeof x.failures === 'number' && Number.isFinite(x.failures) ? x.failures : 0 };
}

export class StockSearch {
  constructor(private readonly opts: StockOptions) {}
  async search(kind: StockKind, query: string, provider?: StockProvider, signal?: AbortSignal): Promise<{ results: StockResult[]; notes: string[] }> {
    const results: StockResult[] = [], notes: string[] = [];
    if (!query.trim()) return { results, notes };
    const providers: StockProvider[] = provider ? [provider] : kind === 'video' ? ['pexels', 'pixabay'] : ['pexels', 'pixabay', 'openverse'];
    for (const p of providers) {
      if (p === 'openverse' && kind !== 'image') continue;
      const key = p === 'openverse' ? null : await this.opts.key(p);
      if (p !== 'openverse' && !key) continue;
      const lock = path.join(this.opts.settingsDir, `stock-${p}`);
      const run = (queues.get(lock) ?? Promise.resolve()).catch(() => undefined).then(async () => {
        signal?.throwIfAborted();
        try { return await this.request(p, kind, query.trim(), key, signal); }
        catch {
          signal?.throwIfAborted();
          // Fetch errors can contain Pixabay's authenticated URL. Neither errors nor response bodies leave here.
          return { results: [], note: `${LABELS[p]} search is unavailable. Try again later.` };
        }
      });
      queues.set(lock, run);
      const got = await run.finally(() => { if (queues.get(lock) === run) queues.delete(lock); });
      results.push(...got.results);
      if (got.note) notes.push(got.note);
    }
    return { results: results.slice(0, 3), notes };
  }
  private async request(provider: StockProvider, kind: StockKind, query: string, key: string | null, signal?: AbortSignal): Promise<{ results: StockResult[]; note?: string }> {
    if (provider === 'pixabay') query = query.slice(0, 100);
    const now = this.opts.now?.() ?? Date.now();
    const dir = path.join(this.opts.settingsDir, 'stock-cache');
    const id = createHash('sha256').update(`${provider}:${kind}:${query}`).digest('hex');
    const cacheFile = path.join(dir, `${id}.json`);
    if (provider === 'pixabay') {
      const cached = record(await readJson(cacheFile));
      if (typeof cached.at === 'number' && now >= cached.at && now - cached.at < DAY) return { results: mapResults(cached.response, provider, kind) };
    }
    const stateFile = path.join(dir, `${provider}-rate.json`);
    const state = rateState(await readJson(stateFile));
    state.requests = state.requests.filter(t => now - t < (provider === 'pexels' ? 31 * DAY : DAY));
    // Published defaults: Pexels 200/h and 20,000/month; Pixabay 100/min. Openverse uses a conservative anonymous budget.
    const recent = (period: number) => state.requests.filter(t => now - t < period).length;
    const limited = provider === 'pexels' ? recent(3_600_000) >= 200 || state.requests.length >= 20_000
      : provider === 'pixabay' ? recent(60_000) >= 100 : recent(1000) >= 1 || recent(DAY) >= 100;
    if (now < state.blockedUntil || limited) return { results: [], note: `${LABELS[provider]} rate limit: try again later.` };
    state.requests.push(now);
    await writeFileAtomic(stateFile, JSON.stringify(state), 0o600);
    const url = new URL(provider === 'pexels' ? `https://api.pexels.com/v1/${kind === 'video' ? 'videos/search' : 'search'}`
      : provider === 'pixabay' ? `https://pixabay.com/api/${kind === 'video' ? 'videos/' : ''}` : 'https://api.openverse.org/v1/images/');
    url.searchParams.set(provider === 'pexels' ? 'query' : 'q', query);
    url.searchParams.set(provider === 'openverse' ? 'page_size' : 'per_page', '3');
    if (provider === 'pixabay') { url.searchParams.set('key', key!); url.searchParams.set('safesearch', 'true'); }
    if (provider === 'openverse') url.searchParams.set('license', 'by,cc0,pdm');
    const response = await (this.opts.fetchImpl ?? fetch)(url.href, {
      headers: provider === 'pexels' ? { Authorization: key! } : {},
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (response.status === 429) {
      state.failures++;
      const retry = response.headers.get('retry-after');
      const seconds = retry === null ? NaN : Number(retry);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : retry ? Date.parse(retry) - now : 0;
      state.blockedUntil = now + Math.max(30_000 * 2 ** Math.min(state.failures - 1, 7), Number.isFinite(retryMs) ? retryMs : 0);
      await response.body?.cancel();
      await writeFileAtomic(stateFile, JSON.stringify(state), 0o600);
      return { results: [], note: `${LABELS[provider]} rate limit: try again later.` };
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error('Stock API request failed'); }
    // Stop at the published remaining quota even when other apps spend the same key's allowance.
    if (response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const wait = provider === 'pexels' ? reset * 1000 - now : reset * 1000;
      state.blockedUntil = now + Math.max(provider === 'pexels' ? 3_600_000 : 60_000, Number.isFinite(wait) ? wait : 0);
    }
    state.failures = 0;
    await writeFileAtomic(stateFile, JSON.stringify(state), 0o600);
    const raw: unknown = await response.json();
    if (provider === 'pixabay') await writeFileAtomic(cacheFile, JSON.stringify({ at: now, response: raw }), 0o600);
    return { results: mapResults(raw, provider, kind) };
  }
}
