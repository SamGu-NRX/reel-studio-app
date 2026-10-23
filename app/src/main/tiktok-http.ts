// TikTok API v2: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/
// OAuth v2 errors: https://developers.tiktok.com/doc/oauth-error-handling/
// Status v2: https://developers.tiktok.com/doc/content-posting-api-reference-get-video-status/
export type TikTokFetch = (url: string, init: RequestInit) => Promise<Response>
export const TIKTOK_API = 'https://open.tiktokapis.com/v2'
export class TikTokError extends Error {
  constructor(readonly code: string, readonly userMessage: string, readonly status?: number) { super(userMessage) }
}
export function fail(code: string, message: string): never { throw new TikTokError(code, message) }
export function invalid(): never { return fail('TT_RESPONSE', 'TikTok returned incomplete data. Try again later.') }
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return Object.fromEntries(Object.entries(value))
}
export function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 10_000) return invalid()
  return value
}
export function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return invalid()
  return value
}
export function positive(value: unknown): number {
  const result = count(value)
  if (!result) return invalid()
  return result
}
export function httpsUrl(value: unknown): URL {
  let url: URL
  try { url = new URL(text(value)) } catch { return invalid() }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return invalid()
  return url
}
export function jsonPost(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}
export function apiError(code: string, status = 400): TikTokError {
  const messages: Record<string, [string, string]> = {
    access_token_invalid: ['TT_TOKEN', 'Your TikTok connection expired. Connect TikTok again in Settings.'],
    invalid_grant: ['TT_TOKEN', 'Your TikTok authorization expired or was revoked. Connect TikTok again in Settings.'],
    auth_removed: ['TT_TOKEN', 'TikTok access was removed. Connect TikTok again in Settings.'],
    scope_not_authorized: ['TT_PERMISSION', 'Allow the required TikTok permissions when connecting in Settings.'],
    invalid_scope: ['TT_PERMISSION', 'The TikTok app needs approval for the requested permissions. Check its developer settings.'],
    access_denied: ['TT_DECLINED', 'TikTok was not connected. You can try again in Settings.'],
    unaudited_client_can_only_post_to_private_accounts: ['TT_PRIVATE_ONLY', 'This TikTok app has not passed its audit. Direct posts are private-only. Use a private account and choose Only me, or send a draft to your TikTok inbox.'],
    privacy_level_option_mismatch: ['TT_PRIVACY', 'Choose one of the privacy options currently allowed by your TikTok account.'],
    spam_risk_too_many_pending_share: ['TT_DRAFT_LIMIT', 'Your TikTok inbox has too many pending drafts. Finish or remove a draft in TikTok before uploading again.'],
    spam_risk_too_many_posts: ['TT_POST_LIMIT', 'TikTok has reached your daily posting limit. Try again tomorrow.'],
    reached_active_user_cap: ['TT_APP_LIMIT', 'This TikTok app has reached its daily creator limit. Try again tomorrow.'],
    spam_risk_user_banned_from_posting: ['TT_BANNED', 'TikTok has blocked posting for this account. Check your account in TikTok.'],
    spam_risk_text: ['TT_CAPTION', 'TikTok rejected this caption. Review it in TikTok before trying a new export.'],
    spam_risk: ['TT_REJECTED', 'TikTok rejected this post for safety review. Check your account in TikTok.'],
    file_format_check_failed: ['TT_FORMAT', 'TikTok could not use this video format. Export an MP4 video again.'],
    duration_check_failed: ['TT_DURATION', 'This video is too short or too long for TikTok. Change its length and export again.'],
    frame_rate_check_failed: ['TT_FRAME_RATE', 'TikTok could not use this frame rate. Export the video again.'],
    picture_size_check_failed: ['TT_SIZE', 'TikTok could not use these video dimensions. Export the video again.'],
    video_pull_failed: ['TT_TRANSFER', 'TikTok could not download the video. Start a new export before trying again.'],
    photo_pull_failed: ['TT_TRANSFER', 'TikTok could not download the image. Start a new export before trying again.'],
    publish_cancelled: ['TT_CANCELLED', 'The TikTok publish was cancelled.'],
    invalid_publish_id: ['TT_PUBLISH_ID', 'TikTok could not find this upload. Check TikTok before starting another export.'],
    token_not_authorized_for_specified_publish_id: ['TT_ACCOUNT', 'This upload belongs to another TikTok connection. Connect the original account.'],
    url_ownership_unverified: ['TT_URL', 'TikTok has not approved the media address. Use a local video upload.']
  }
  const alias = Object.values(messages).find(([mapped]) => mapped === code)
  const known = Object.hasOwn(messages, code) ? messages[code] : alias
  if (known) return new TikTokError(...known, status)
  if (status === 429 || ['rate_limit_exceeded', 'TT_RATE_LIMIT'].includes(code)) return new TikTokError('TT_RATE_LIMIT', 'TikTok has reached a request limit. Wait a few minutes before trying again.', status)
  if (status === 401) return new TikTokError('TT_TOKEN', 'Your TikTok connection expired. Connect TikTok again in Settings.', status)
  if (['TT_SETUP', 'invalid_client', 'unauthorized_client', 'unsupported_grant_type', 'unsupported_response_type'].includes(code))
    return new TikTokError('TT_SETUP', 'The TikTok app or authorization server is not configured correctly. Check developer settings.', status)
  if (['TT_INPUT', 'invalid_param', 'invalid_request'].includes(code)) return new TikTokError('TT_INPUT', 'TikTok could not use this request. Check the export and settings.', status)
  if (status === 403) return new TikTokError('TT_PERMISSION', 'TikTok did not allow this action. Check your account permissions and app approval.', status)
  return new TikTokError('TT_API', 'TikTok could not finish this request. Try again later.', status)
}
export async function transport(fetcher: TikTokFetch, url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted()
  try { return await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) }) }
  catch { signal.throwIfAborted(); return fail('TT_NETWORK', 'TikTok could not be reached. Check your connection and resume this upload later.') }
}
export async function request(fetcher: TikTokFetch, url: string, init: RequestInit, signal: AbortSignal, envelope = true): Promise<Record<string, unknown>> {
  const res = await transport(fetcher, url, init, signal)
  let data: Record<string, unknown>
  try { data = object(await res.json()) } catch {
    if (!res.ok) throw apiError('', res.status)
    return invalid()
  }
  const error = typeof data.error === 'string' ? data.error : data.error ? text(object(data.error).code) : undefined
  if (!res.ok || (error !== undefined && error !== 'ok')) throw apiError(error ?? '', res.status)
  if (envelope) {
    if (error !== 'ok') return invalid()
    return object(data.data)
  }
  return data
}
