export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'facebook' | 'threads' | 'x' | 'linkedin'

export interface PlatformRule {
  id: Platform
  label: string
  minSeconds?: number
  maxSeconds: number
  maxBytes: number
  maxBitrate?: number
  maxAudioBitrate?: number
  noEditLists?: true
  /** Seconds; a longer gap between keyframes needs a re-encode. */
  maxKeyframeGap?: number
  captionLimit: number | null
  hashtagLimit: number | null
  width: number
  height: number
  source: string
  note?: string
  /** The platform's own test of two versions of one post: Instagram trial reels test any change, Facebook only a cover or caption. */
  tryTwo?: { tests: 'video' | 'cover-caption'; steps: string; source: string }
}

// Offline targets checked 2026-10-22. Notes distinguish account-dependent and local limits.
export const PLATFORM_RULES: readonly PlatformRule[] = [
  { id: 'instagram', label: 'Instagram Reels', minSeconds: 3, maxSeconds: 900, maxBytes: 300_000_000, maxBitrate: 25_000_000, maxAudioBitrate: 128_000, noEditLists: true, captionLimit: 2200, hashtagLimit: 30, width: 1080, height: 1920, source: 'https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media',
    tryTwo: { tests: 'video', source: 'https://creators.instagram.com/blog/instagram-trial-reels', steps: "Post each video as a trial reel. Before you share, turn on Trial and leave automatic sharing off. Instagram shows trial reels to people who don't follow you first. After about a day, compare their views, then tap Share with everyone on the one that did better. No Trial switch? Your account can't use trial reels yet, so post Try 1." } },
  { id: 'tiktok', label: 'TikTok', maxSeconds: 180, maxBytes: 4_000_000_000, captionLimit: 2200, hashtagLimit: null, width: 1080, height: 1920, source: 'https://developers.tiktok.com/doc/content-posting-api-reference-direct-post', note: '3-minute offline target. Your account may allow more. Check its upload limit before posting.' },
  { id: 'youtube', label: 'YouTube Shorts', maxSeconds: 180, maxBytes: 256_000_000_000, captionLimit: 5000, hashtagLimit: 60, width: 1080, height: 1920, source: 'https://support.google.com/youtube/answer/15424877', note: 'The caption is a description. Add a separate title of up to 100 characters when you upload.' },
  { id: 'facebook', label: 'Facebook Reels', minSeconds: 3, maxSeconds: 90, maxBytes: 1_000_000_000, maxKeyframeGap: 5, captionLimit: null, hashtagLimit: null, width: 1080, height: 1920, source: 'https://developers.facebook.com/documentation/video-api/guides/reels-publishing', note: '90-second Reels target. The current guide does not give a caption, hashtag or byte maximum; 1 GB is the local file ceiling.',
    tryTwo: { tests: 'cover-caption', source: 'https://about.fb.com/news/2023/11/helping-creators-test-content-and-earn-rewards/', steps: "In the Facebook app, make the reel with the video. Before you share, add Try 2's cover and caption as a test. Facebook shows each to part of your audience and keeps the one that does better. No test option? Post Try 1." } },
  { id: 'threads', label: 'Threads', maxSeconds: 300, maxBytes: 1_000_000_000, maxAudioBitrate: 128_000, noEditLists: true, captionLimit: 500, hashtagLimit: null, width: 1080, height: 1920, source: 'https://developers.facebook.com/documentation/threads/posts', note: 'Only one topic becomes a linked tag. Each emoji counts as its size in bytes, usually 4.' },
  { id: 'x', label: 'X', minSeconds: 0.5, maxSeconds: 1200, maxBytes: 8_000_000_000, captionLimit: 280, hashtagLimit: null, width: 720, height: 1280, source: 'https://docs.x.com/x-api/media/quickstart/best-practices', note: 'Standard account target. Every https:// link counts as 23. Confirm the caption length in X before posting.' },
  // LinkedIn's caption limit is the composer's: "Posts can contain up to 3,000 characters." (linkedin.com/help/linkedin/answer/a528176)
  { id: 'linkedin', label: 'LinkedIn', minSeconds: 3, maxSeconds: 1800, maxBytes: 500_000_000, captionLimit: 3000, hashtagLimit: null, width: 1080, height: 1920, source: 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api', note: 'Uses the documented 500 MB video specification, below the larger multipart upload ceiling.' }
]

export function platformRule(platform: Platform): PlatformRule {
  const rule = PLATFORM_RULES.find((r) => r.id === platform)
  if (!rule) throw new Error(`Unknown export platform: ${platform}`)
  return rule
}

/** One version of the post: which Version's video, which cover and which caption. */
export interface PlatformTry {
  version: number
  caption: string
  /** Seconds into the finished video, or null for that version's own cover. */
  coverSeconds: number | null
  /** Added to the picture's brightness when it is exported (ffmpeg eq, -1 to 1). Absent or 0: as rendered. */
  brightness?: number
}

/** The one thing Try 2 changes. The hook line is the caption's first line (ai/prompts/firstEdit.md, "caption"). */
export type TryVariable = 'hook' | 'cover' | 'caption' | 'brightness'
export const TRY_VARIABLES: readonly TryVariable[] = ['hook', 'cover', 'caption', 'brightness']

/**
 * What Try 2 changes and to what: a new hook line, the caption after the hook line, a cover time in seconds, or a
 * brightness step. `reason` is the editor's one line in its own voice; null when the app chose, with no editor.
 */
export type TryProposal =
  | { variable: 'hook' | 'caption'; value: string; reason: string | null }
  | { variable: 'cover' | 'brightness'; value: number; reason: string | null }

/** The brightness range the editor may propose (ai/prompts/proposeTry.md). No viewer test backs it: 0.02 is a guess at
 * the smallest step that shows on a phone, 0.15 at the most before faces wash out. */
const BRIGHTNESS_STEP = { min: 0.02, max: 0.15 }

const lines = (caption: string): [string, string] => {
  const i = caption.indexOf('\n')
  return i < 0 ? [caption, ''] : [caption.slice(0, i), caption.slice(i + 1)]
}
/** The caption's first line, which shows before "more". */
const hookLine = (caption: string): string => lines(caption)[0]
/** Everything after the hook line. */
const captionBody = (caption: string): string => lines(caption)[1]

/** Why `p` can't be Try 2 for a reel of `duration` seconds whose caption is `caption`, or null. */
function tryProposalProblem(p: TryProposal, caption: string, duration: number): string | null {
  switch (p.variable) {
    case 'hook': {
      const line = p.value.trim()
      if (!line || line.includes('\n')) return 'The hook line must be one line.'
      return line === hookLine(caption).trim() ? 'The hook line is the same as Try 1.' : null
    }
    case 'caption':
      return !p.value.trim() || p.value.trim() === captionBody(caption).trim() ? 'The caption is the same as Try 1.' : null
    case 'cover':
      return Number.isFinite(p.value) && p.value >= 0 && p.value <= duration ? null : 'The cover must be a frame inside the video.'
    case 'brightness': {
      const step = Math.abs(p.value)
      return Number.isFinite(p.value) && step >= BRIGHTNESS_STEP.min && step <= BRIGHTNESS_STEP.max ? null : 'The brightness change is too small or too large.'
    }
  }
}

/** Reads a proposal the editor returned; throws a specific error for anything else. */
export function parseTryProposal(value: unknown, caption: string, duration: number): TryProposal {
  const v = (value ?? {}) as Record<string, unknown>
  const reason = typeof v.reason === 'string' && v.reason.trim() ? v.reason.trim() : null
  if (!reason) throw new Error('A Try 2 proposal from the editor needs its reason')
  let p: TryProposal
  if ((v.variable === 'hook' || v.variable === 'caption') && typeof v.value === 'string') p = { variable: v.variable, value: v.value.trim(), reason }
  else if ((v.variable === 'cover' || v.variable === 'brightness') && typeof v.value === 'number') p = { variable: v.variable, value: v.value, reason }
  else throw new Error(`Not a Try 2 proposal: ${JSON.stringify(value)?.slice(0, 200)}`)
  const problem = tryProposalProblem(p, caption, duration)
  if (problem) throw new Error(`The editor's Try 2 proposal can't be used: ${problem}`)
  return p
}

/** Try 2: Try 1 with the proposal's one change. The caption parts are joined with Try 1's caption as it is now. */
export function tryFromProposal(first: PlatformTry, p: TryProposal): PlatformTry {
  const [hook, body] = lines(first.caption)
  switch (p.variable) {
    case 'hook': return { ...first, caption: body ? `${p.value}\n${body}` : p.value }
    case 'caption': return { ...first, caption: `${hook}\n${p.value}` }
    case 'cover': return { ...first, coverSeconds: p.value }
    case 'brightness': return { ...first, brightness: p.value }
  }
}

/**
 * The cover the app picks for Try 2 when no editor is connected: the end of the word nearest 60% of the way in (a
 * word's end, so the mouth is closing), or 35% when that is within a second of the current cover. Both points are
 * away from the opening frame the render's own fallback cover uses (render.py fallback_cover); no test of viewers
 * backs these numbers.
 */
export function appCoverPick(duration: number, words: { s: number; e: number }[], current: number | null): number {
  const near = (t: number) => {
    const w = words.reduce<{ s: number; e: number } | null>((best, x) => (!best || Math.abs(x.e - t) < Math.abs(best.e - t) ? x : best), null)
    return Math.min(duration, w && Math.abs(w.e - t) < 2 ? w.e : t)
  }
  const pick = near(duration * 0.6)
  return current !== null && Math.abs(pick - current) < 1 ? near(duration * 0.35) : pick
}

export interface PlatformExportRequest {
  platforms: Platform[]
  caption: string
  /** Seconds into the finished video, or null for the project's own cover. */
  coverSeconds: number | null
  /** Try 2, for the platforms that can test two versions themselves (`secondTryPlatforms`). */
  second: PlatformTry | null
}

const validCover = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
const validCaption = (value: unknown): value is string => typeof value === 'string' && value.length <= 100_000
const validVersion = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
const validBrightness = (value: unknown): value is number | undefined =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= BRIGHTNESS_STEP.max)

const badRequest = () => ({ code: 'BAD_EXPORT', userMessage: 'Choose at least one platform and a valid cover frame, then try again.' })

function parseSecondTry(value: unknown): PlatformTry | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || !('version' in value) || !validVersion(value.version) ||
      !('caption' in value) || !validCaption(value.caption) || !('coverSeconds' in value) || !validCover(value.coverSeconds)) throw badRequest()
  const brightness = 'brightness' in value ? value.brightness : undefined
  if (!validBrightness(brightness)) throw badRequest()
  return { version: value.version, caption: value.caption, coverSeconds: value.coverSeconds, ...(brightness ? { brightness } : {}) }
}

export function parsePlatformExportRequest(value: unknown): PlatformExportRequest {
  if (!value || typeof value !== 'object' || !('platforms' in value) || !Array.isArray(value.platforms) ||
      !value.platforms.length || value.platforms.length > PLATFORM_RULES.length ||
      !value.platforms.every((p): p is Platform => typeof p === 'string' && PLATFORM_RULES.some((r) => r.id === p)) ||
      !('caption' in value) || !validCaption(value.caption) || !('coverSeconds' in value) || !validCover(value.coverSeconds) ||
      !('second' in value)) throw badRequest()
  return { platforms: [...new Set(value.platforms)], caption: value.caption, coverSeconds: value.coverSeconds, second: parseSecondTry(value.second) }
}

export type TryChange = 'video' | 'brightness' | 'cover' | 'caption'

/** Both tries play the same picture: the same version at the same brightness. */
export const sameVideo = (first: PlatformTry, second: PlatformTry): boolean =>
  second.version === first.version && (second.brightness ?? 0) === (first.brightness ?? 0)

/** `fps` is the render's: two cover times on the same frame are the same cover. */
export function tryChanges(first: PlatformTry, second: PlatformTry, fps: number): TryChange[] {
  const frame = (seconds: number | null) => seconds === null ? null : Math.round(seconds * fps)
  const changes: TryChange[] = []
  if (second.version !== first.version) changes.push('video')
  if ((second.brightness ?? 0) !== (first.brightness ?? 0)) changes.push('brightness')
  if (frame(second.coverSeconds) !== frame(first.coverSeconds)) changes.push('cover')
  if (second.caption !== first.caption) changes.push('caption')
  return changes
}

/** The selected platforms that get Try 2. Every selected platform gets Try 1. A brightness change is a change to the video. */
export function secondTryPlatforms(platforms: Platform[], oneVideo: boolean): Platform[] {
  return platforms.filter((p) => {
    const test = platformRule(p).tryTwo
    return test !== undefined && (test.tests === 'video' || oneVideo)
  })
}

/** Why Try 2 cannot be exported, or null. */
export function secondTryProblem(platforms: Platform[], first: PlatformTry, second: PlatformTry, fps: number): string | null {
  const changes = tryChanges(first, second, fps)
  if (!changes.length) return 'Try 2 is the same as Try 1.'
  const video = changes.includes('video') || changes.includes('brightness')
  if (secondTryPlatforms(platforms, !video).length) return null
  return video
    ? 'Only Instagram can test a change to the video. Tick Instagram Reels, or undo Try 2.'
    : 'None of these platforms can test two versions. Tick Instagram Reels or Facebook Reels, or undo Try 2.'
}

export interface ExportIssue {
  kind: 'caption' | 'hashtags' | 'mentions' | 'duration'
  message: string
  /** false: our count or limit is an estimate, so the creator decides. */
  blocking: boolean
}

const LINK = /https?:\/\/\S+/gu
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u
const utf8Length = (text: string): number => new TextEncoder().encode(text).length
const graphemes = (text: string): string[] => [...new Intl.Segmenter().segment(text)].map((s) => s.segment)

/** The caption length as each platform counts it against `captionLimit`. */
export function captionLength(platform: Platform, caption: string): number {
  if (platform === 'youtube') return utf8Length(caption)
  if (platform === 'threads') return graphemes(caption).reduce((n, g) => n + (EMOJI.test(g) ? utf8Length(g) : 1), 0)
  if (platform === 'x') return xWeightedLength(caption)
  return caption.length
}

export function checkPlatform(platform: Platform, caption: string, seconds: number): ExportIssue[] {
  const rule = platformRule(platform)
  const issues: ExportIssue[] = []
  const count = captionLength(platform, caption)
  if (platform === 'youtube' && /[<>]/u.test(caption)) issues.push({ kind: 'caption', blocking: true, message: 'YouTube descriptions cannot contain < or >. Remove those characters before sharing.' })
  if (rule.captionLimit !== null && count > rule.captionLimit) {
    issues.push(platform === 'x'
      ? { kind: 'caption', blocking: false, message: `Probably ${count} of ${rule.captionLimit} once links are shortened. Shorten the caption, or check it in X before posting.` }
      : { kind: 'caption', blocking: true, message: `Caption is ${count} of ${rule.captionLimit}. Shorten it before sharing.` })
  }
  // A link's #fragment, an e-mail address or "issue#5" is not a tag or a mention; "#one#two" is two tags.
  const words = caption.replace(LINK, ' ')
  const tags = (words.match(/(?<![\p{L}\p{N}_])#[\p{L}\p{N}_]+(?:#[\p{L}\p{N}_]+)*/gu) ?? []).reduce((n, run) => n + run.split('#').length - 1, 0)
  const mentions = (words.match(/(?<![\p{L}\p{N}_.])@[a-zA-Z0-9_.]+/gu) ?? []).length
  if (platform === 'instagram' && mentions > 20) issues.push({ kind: 'mentions', blocking: true, message: 'Instagram allows at most 20 mentions. Remove extra @mentions before sharing.' })
  if (rule.hashtagLimit !== null && tags > rule.hashtagLimit) issues.push({ kind: 'hashtags', blocking: true, message: `${tags} hashtags; use at most ${rule.hashtagLimit}.` })
  if (seconds > rule.maxSeconds) {
    issues.push(platform === 'tiktok'
      ? { kind: 'duration', blocking: false, message: `This reel is ${seconds.toFixed(1)} s. Some TikTok accounts only take ${rule.maxSeconds} s; check yours before posting.` }
      : { kind: 'duration', blocking: true, message: `This reel is ${seconds.toFixed(1)} s. Trim it to ${rule.maxSeconds} s or less in the Cut tab.` })
  }
  if (rule.minSeconds !== undefined && seconds < rule.minSeconds) issues.push({ kind: 'duration', blocking: true, message: `This platform needs a reel of at least ${rule.minSeconds} s.` })
  return issues
}

// docs.x.com/fundamentals/counting-characters: links count 23, emoji 2, and these ranges (Latin,
// punctuation, common symbols) 1; everything else 2. Links without https:// are not detected here.
const X_LIGHT: [number, number][] = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]]

function xWeightedLength(text: string): number {
  let links = 0
  // X counts after NFC normalization, so a decomposed "é" is one character.
  const rest = text.normalize('NFC').replace(LINK, (link) => {
    links++
    return /[.,!?;:)]+$/u.exec(link)?.[0] ?? ''
  })
  return links * 23 + graphemes(rest).reduce((n, g) => n + (EMOJI.test(g)
    ? 2
    : [...g].reduce((m, ch) => m + (X_LIGHT.some(([a, b]) => ch.codePointAt(0)! >= a && ch.codePointAt(0)! <= b) ? 1 : 2), 0)), 0)
}

/** What `export-probe` reports about the finished render. */
export interface FinishedVideo {
  duration: number
  width: number
  height: number
  fps: number
  vcodec: string | null
  acodec: string | null
  pixFmt: string | null
  sizeBytes: number
  audioBitrate: number | null
  editList: boolean
  maxKeyframeGap: number
}

/**
 * How the final render (H.264 High at CRF 18, AAC 192k; engine/reelengine/render.py) becomes this platform's
 * file: as it is, with only its audio redone and its edit list dropped (remux), or re-encoded.
 */
function preparation(platform: Platform, video: FinishedVideo): 'copy' | 'remux' | 'encode' {
  const rule = platformRule(platform)
  const pictureFits = video.vcodec === 'h264' && video.acodec === 'aac' && video.pixFmt === 'yuv420p' &&
    video.width === rule.width && video.height === rule.height && video.fps >= 24 && video.fps <= 60 &&
    video.sizeBytes <= rule.maxBytes && (rule.maxBitrate === undefined || video.sizeBytes * 8 / video.duration <= rule.maxBitrate) &&
    (rule.maxKeyframeGap === undefined || video.maxKeyframeGap <= rule.maxKeyframeGap)
  if (!pictureFits) return 'encode'
  const audioFits = rule.maxAudioBitrate === undefined || (video.audioBitrate !== null && video.audioBitrate <= rule.maxAudioBitrate)
  return audioFits && !(rule.noEditLists && video.editList) ? 'copy' : 'remux'
}

export interface ExportSpec {
  width: number
  height: number
  videoBitrate: number
}

export function exportSpec(platform: Platform, seconds: number): ExportSpec {
  const rule = platformRule(platform)
  // Leave 6% for container overhead and 128 kb/s for the audio; the bytes are checked after encoding.
  const budget = Math.floor(rule.maxBytes * 0.94 * 8 / Math.max(seconds, 1) - 128_000)
  return { width: rule.width, height: rule.height, videoBitrate: Math.min(8_000_000, budget) }
}

/**
 * Platforms that need their own file, grouped so matching outputs share one. A null spec is a remux. `encode`: every
 * platform gets a re-encode, as a brightness change needs.
 */
export function outputGroups(platforms: Platform[], video: FinishedVideo, { encode = false } = {}): { platforms: Platform[]; spec: ExportSpec | null }[] {
  const groups = new Map<string, { platforms: Platform[]; spec: ExportSpec | null }>()
  for (const platform of platforms) {
    const how = encode ? 'encode' : preparation(platform, video)
    if (how === 'copy') continue
    const spec = how === 'encode' ? exportSpec(platform, video.duration) : null
    const key = JSON.stringify(spec)
    const group = groups.get(key)
    if (group) group.platforms.push(platform)
    else groups.set(key, { platforms: [platform], spec })
  }
  return [...groups.values()]
}
