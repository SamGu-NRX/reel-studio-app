// TikTok API v2: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post/
// Stats v2: https://developers.tiktok.com/doc/tiktok-api-v2-video-query/
import type { InstagramMetrics, InstagramPost } from './instagram'

export interface TikTokSettings {
  tiktokEnabled: boolean
  tiktokClientKey: string | null
  tiktokBrokerUrl: string | null
  tiktokAudited: boolean
  tiktokDirectPost: boolean
}
export type TikTokSession = { connected: false } | {
  connected: true; accountId: string; displayName: string; expiresAt: number; scopes: string[]
}
export type TikTokPrivacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'
export interface TikTokCreator {
  displayName: string
  privateOnly: boolean
  privacyOptions: TikTokPrivacy[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number
}
export interface TikTokPublishInput {
  slug: string
  version: number
  caption: string
  mode: 'direct-or-inbox' | 'inbox'
  consent: true
  privacy: TikTokPrivacy
  durationSec: number
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandContent: boolean
  brandOrganic: boolean
  isAigc: boolean
}
export interface TikTokPublishResult {
  state: 'processing' | 'inbox' | 'published'
  mode: 'direct' | 'inbox'
  publishId: string
  postIds: string[]
  privateOnly: boolean
  message: string
}
export interface TikTokOutcome extends InstagramPost {
  platform: 'tiktok'
  apiVersion: 'v2'
  observedAt: string | null
  metrics: InstagramMetrics | null
}
export interface TikTokApi {
  configure(settings: TikTokSettings): Promise<void>
  session(): Promise<TikTokSession>
  connect(): Promise<TikTokSession>
  cancelConnect(): Promise<void>
  disconnect(): Promise<void>
  creator(): Promise<TikTokCreator>
  publish(input: TikTokPublishInput): Promise<TikTokPublishResult>
  insights(slug: string, version: number, postId: string): Promise<TikTokOutcome>
}
