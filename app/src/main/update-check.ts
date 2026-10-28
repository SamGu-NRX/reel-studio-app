// Preserve main's published vX.Y.Z selection, including GitHub prereleases. A nightly build (shared/channel.ts)
// follows only the fork's vX.Y.Z-nightly.YYYYMMDD.N releases, and the stable app never sees those.
import { channelOf, RELEASES_REPOS, type Channel } from '../shared/channel'
import { validDate } from '../shared/update'
import type { UpdateBackend } from './updater'

/** An app release on GitHub: its version, release page, raw markdown notes and publish time. */
export interface FoundUpdate {
  version: string
  releaseUrl: string
  notes: string | null
  publishedAt?: string | null
}

export interface ReleaseCheck {
  update: FoundUpdate | null
  releases: FoundUpdate[]
  /** The update exists but this copy cannot install it (its release lacks a usable feed): offer its page. */
  pageOnly?: boolean
}

export const releasesApi = (channel: Channel): string => `https://api.github.com/repos/${RELEASES_REPOS[channel]}/releases`
export const RELEASES_API = releasesApi('stable')
/** Every release page lives under here. The ONLY URLs the notice may open. */
export const RELEASE_PAGE_ORIGIN = 'https://github.com'
export const releasePagePrefix = (channel: Channel): string => `/${RELEASES_REPOS[channel]}/releases/`
export const RELEASE_PAGE_PREFIX = releasePagePrefix('stable')
export const TIMEOUT_MS = 10_000

/** App releases only: `v1.2.3`. Other tags (e.g. `ffmpeg-7.1.1-rs2`, `v1.2`, `v1.2.3-beta`) are not app versions. */
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/
/** Nightly releases only: `v1.2.3-nightly.20261028.17` (date, then the workflow's run number). */
const NIGHTLY_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/
/** The running app's own version: `1.2.3`, optionally with a pre-release suffix (`1.2.3-beta.1`). */
const APP_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/

type Triple = [number, number, number]
/** Stable: [major, minor, patch]. Nightly: the same, then date and run number, so several nightlies a day sort. */
type Key = number[]

export function parseTag(tag: unknown): Triple | null {
  if (typeof tag !== 'string') return null
  const m = TAG_RE.exec(tag)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** A version string of one of the channel's releases: `1.2.3`, or `1.2.3-nightly.20261028.17` for the nightly. */
export const isReleaseVersion = (v: unknown, channel: Channel): v is string => typeof v === 'string' && parseChannelTag(`v${v}`, channel) !== null

/** The sort key of a channel's release tag, or null when the tag is not one of that channel's releases. */
export function parseChannelTag(tag: unknown, channel: Channel): Key | null {
  if (channel === 'stable') return parseTag(tag)
  if (typeof tag !== 'string') return null
  const m = NIGHTLY_TAG_RE.exec(tag)
  return m ? m.slice(1, 6).map(Number) : null
}

function parseAppVersion(v: string): { t: Triple; pre: boolean } | null {
  const m = APP_VERSION_RE.exec(v.trim())
  return m ? { t: [Number(m[1]), Number(m[2]), Number(m[3])], pre: !!m[4] } : null
}

function cmp(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return (a[i] ?? -1) < (b[i] ?? -1) ? -1 : 1
  return 0
}

/** Is release `release` (e.g. "0.1.1") newer than the running app `current` (e.g. "0.1.0")? Semver order;
 * a release of the same number as a pre-release build (0.2.0 vs 0.2.0-beta.1) is newer. A nightly build only
 * counts later nightlies (version, then date, then run), and a stable build never counts a nightly. */
export function isNewer(release: string, current: string): boolean {
  if (channelOf(current) === 'nightly') {
    const r = parseChannelTag(`v${release}`, 'nightly')
    const c = parseChannelTag(`v${current}`, 'nightly')
    return !!r && !!c && cmp(r, c) > 0
  }
  const r = parseAppVersion(release)
  const c = parseAppVersion(current)
  if (!r || !c || r.pre) return false
  const d = cmp(r.t, c.t)
  return d > 0 || (d === 0 && c.pre)
}

/** Only the channel's own `https://github.com/<repo>/releases/...`. Parsed, not string-matched, so
 * `..`, `%2e%2e`, backslashes, `user@`, other ports or look-alike hosts cannot sneak past. Returns the
 * normalised URL to open, or null. */
export function allowedReleaseUrl(url: unknown, channel: Channel = 'stable'): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.origin !== RELEASE_PAGE_ORIGIN || u.username || u.password) return null
  if (!u.pathname.startsWith(releasePagePrefix(channel))) return null
  return u.href
}

/** A release's page; a nightly tag (`v1.2.3-nightly.…`) lives on the nightly repo. */
export const pageFor = (tag: string): string => `${RELEASE_PAGE_ORIGIN}${releasePagePrefix(channelOf(tag))}tag/${tag}`

/** Every app release of `channel` in GitHub's releases list, newest first. Drafts and other tags are ignored;
 * pre-releases count (every release is a pre-release for now). Never throws on odd data. */
export function appReleases(list: unknown, channel: Channel = 'stable'): FoundUpdate[] {
  if (!Array.isArray(list)) return []
  const found: { t: Key; release: FoundUpdate }[] = []
  for (const r of list) {
    if (!r || typeof r !== 'object') continue
    const { draft, tag_name, html_url, body, published_at } = r as { draft?: unknown; tag_name?: unknown; html_url?: unknown; body?: unknown; published_at?: unknown }
    if (draft !== false) continue // drafts, and anything that does not say it is not one
    const t = parseChannelTag(tag_name, channel)
    if (!t || found.some((f) => cmp(f.t, t) === 0)) continue
    // The API's link is used only if it points at our releases; otherwise build the page link ourselves.
    found.push({
      t,
      release: {
        version: channel === 'stable' ? t.join('.') : (tag_name as string).slice(1),
        releaseUrl: allowedReleaseUrl(html_url, channel) ?? pageFor(tag_name as string),
        notes: typeof body === 'string' ? body : null,
        publishedAt: validDate(published_at)
      }
    })
  }
  return found.sort((a, b) => cmp(b.t, a.t)).map((f) => f.release)
}

// ---- the request ---------------------------------------------------------------------------------

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: 'follow' }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}>

export type AskResult = { kind: 'ok'; releases: FoundUpdate[] } | { kind: 'rate-limited' } | { kind: 'failed'; why: string }

/** The exact headers sent. Nothing else: no token, no cookie, no machine or user detail. */
export function requestHeaders(appVersion: string): Record<string, string> {
  return { 'User-Agent': `ReelStudio/${appVersion}`, Accept: 'application/vnd.github+json' }
}

/** One GET of the releases list. Never throws. */
export async function askGitHub(fetchFn: FetchLike, appVersion: string, timeoutMs = TIMEOUT_MS, url = releasesApi(channelOf(appVersion))): Promise<AskResult> {
  try {
    const res = await fetchFn(url, { headers: requestHeaders(appVersion), signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
    // GitHub's unauthenticated limit is 60 an hour per IP (a shared campus or office IP can hit it):
    // 403/429 with x-ratelimit-remaining 0 or a retry-after. The updater backs off for a full day.
    if (res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after')))) {
      return { kind: 'rate-limited' }
    }
    if (!res.ok) return { kind: 'failed', why: `HTTP ${res.status}` }
    return { kind: 'ok', releases: appReleases(await res.json(), channelOf(appVersion)) }
  } catch (e) {
    return { kind: 'failed', why: (e as Error)?.name === 'TimeoutError' ? 'timeout' : String((e as Error)?.message ?? e).slice(0, 120) }
  }
}

/** The app releases, and the newest one if it is newer than `appVersion`. Throws when GitHub could not tell
 * (a rate limit carries statusCode 429, so the updater waits a day). `url` is the releases list of the running
 * build's channel (a local server in the update e2e). */
export async function newerRelease(fetchFn: FetchLike, appVersion: string, url = releasesApi(channelOf(appVersion))): Promise<ReleaseCheck> {
  const r = await askGitHub(fetchFn, appVersion, TIMEOUT_MS, url)
  if (r.kind === 'rate-limited') throw Object.assign(new Error('GitHub rate limit'), { statusCode: 429 })
  if (r.kind === 'failed') throw new Error(r.why)
  const newest = r.releases[0]
  return { update: newest && isNewer(newest.version, appVersion) ? newest : null, releases: r.releases }
}

// Copies that cannot replace themselves (a Mac app outside Applications, a build without an update feed) open the page.
export function releasePageBackend(fetchFn: FetchLike, appVersion: string): UpdateBackend {
  return {
    check: () => newerRelease(fetchFn, appVersion),
    download: () => Promise.reject(new Error('This copy opens the download page instead of downloading.')),
    verify: () => Promise.reject(new Error('This copy opens the download page instead of installing.')),
    install() {
      throw new Error('This copy opens the download page instead of installing.')
    }
  }
}
