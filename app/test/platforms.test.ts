import { describe, expect, it } from 'vitest'
import {
  PLATFORM_RULES, appCoverPick, checkPlatform, parseTryProposal, sameVideo, secondTryPlatforms, secondTryProblem, tryChanges, tryFromProposal,
  type PlatformTry, type TryProposal
} from '../src/shared/platforms'

const captionIssue = (...args: Parameters<typeof checkPlatform>) => checkPlatform(...args).find((issue) => issue.kind === 'caption')
const durationIssue = (...args: Parameters<typeof checkPlatform>) => checkPlatform(...args).find((issue) => issue.kind === 'duration')

describe('platform export rules', () => {
  it('fails if a TikTok caption exceeds the documented 2200 UTF-16 character limit', () => {
    expect(captionIssue('tiktok', 'x'.repeat(2201), 30)?.blocking).toBe(true)
  })

  it('fails if Shorts lose the current three-minute limit, in either direction', () => {
    expect(durationIssue('youtube', 'A Short', 70)).toBeUndefined()
    expect(durationIssue('youtube', 'A Short', 181)?.blocking).toBe(true)
  })

  it('fails if TikTok’s conservative three-minute target blocks the export instead of warning', () => {
    expect(durationIssue('tiktok', 'A reel', 200)?.blocking).toBe(false)
  })

  it('flags a YouTube description that fits 5000 characters but exceeds 5000 UTF-8 bytes', () => {
    expect(captionIssue('youtube', 'é'.repeat(2501), 30)?.blocking).toBe(true)
  })

  it('fails if Threads counts every character by bytes instead of only emoji', () => {
    expect(captionIssue('threads', 'é'.repeat(400), 30)).toBeUndefined()
    expect(captionIssue('threads', '😀'.repeat(126), 30)?.blocking).toBe(true)
  })

  it('flags Instagram captions with more than 30 hashtags, including adjacent tags', () => {
    expect(checkPlatform('instagram', '#reel'.repeat(31), 30).some((issue) => issue.kind === 'hashtags')).toBe(true)
  })

  it('fails if X stops trimming punctuation after a short link, or its estimate blocks the export', () => {
    expect(captionIssue('x', `https://x.co/a${'!'.repeat(258)}`, 30)?.blocking).toBe(false)
  })

  it('fails if X counts a long link by its length instead of 23', () => {
    expect(captionIssue('x', `https://example.com/${'a'.repeat(100)} ${'b'.repeat(256)}`, 30)).toBeUndefined()
  })

  it('fails if an e-mail address or a link\'s #fragment counts as an Instagram mention or hashtag', () => {
    const emails = Array.from({ length: 21 }, (_, i) => `person${i}@example.com`).join(' ')
    const links = Array.from({ length: 31 }, (_, i) => `https://example.com/page#part${i}`).join(' ')
    expect(checkPlatform('instagram', emails, 30).some((issue) => issue.kind === 'mentions')).toBe(false)
    expect(checkPlatform('instagram', links, 30).some((issue) => issue.kind === 'hashtags')).toBe(false)
  })

  it('fails if X counts a decomposed é as two characters instead of normalizing it first', () => {
    expect(captionIssue('x', 'e\u0301'.repeat(141), 30)).toBeUndefined()
  })

  it('fails if an Instagram caption contains more than 20 mentions', () => {
    const caption = Array.from({ length: 21 }, (_, index) => `@person${index}`).join(' ')
    expect(checkPlatform('instagram', caption, 30).some((issue) => issue.kind === 'mentions')).toBe(true)
  })

  it('fails if a platform without a test option gets Try 2, or Facebook gets a Try 2 with a different video', () => {
    const all = PLATFORM_RULES.map((rule) => rule.id)
    expect(secondTryPlatforms(all, true)).toEqual(['instagram', 'facebook'])
    expect(secondTryPlatforms(all, false)).toEqual(['instagram'])
  })
})

describe('Try 2 from a proposal', () => {
  const first: PlatformTry = { version: 3, caption: 'Hi guys, quick one\nOne bowl, two folds.\n\n#sourdough', coverSeconds: null }
  const proposals: TryProposal[] = [
    { variable: 'hook', value: 'Sourdough without a mixer', reason: 'I lead with the topic.' },
    { variable: 'caption', value: 'Mix, wait, fold.\n\n#sourdough', reason: 'I give the steps.' },
    { variable: 'cover', value: 7.5, reason: 'I picked your smile.' },
    { variable: 'brightness', value: 0.06, reason: 'I lift it a little.' }
  ]

  // fails if a proposal changes a second thing, which would leave the creator unable to tell what won
  it('changes exactly the one thing the proposal names', () => {
    expect(proposals.map((p) => tryChanges(first, tryFromProposal(first, p), 30))).toEqual([['caption'], ['caption'], ['cover'], ['brightness']])
    expect(tryFromProposal(first, proposals[0]).caption).toBe('Sourdough without a mixer\nOne bowl, two folds.\n\n#sourdough')
    expect(tryFromProposal(first, proposals[1]).caption).toBe('Hi guys, quick one\nMix, wait, fold.\n\n#sourdough')
  })

  // fails if a brighter Try 2 reaches Facebook, which tests only a cover or a caption
  it('counts a brightness change as a change to the video', () => {
    const brighter = tryFromProposal(first, proposals[3])
    expect(sameVideo(first, brighter)).toBe(false)
    expect(secondTryPlatforms(['instagram', 'facebook'], sameVideo(first, brighter))).toEqual(['instagram'])
    expect(secondTryProblem(['facebook'], first, brighter, 30)).toBe('Only Instagram can test a change to the video. Tick Instagram Reels, or undo Try 2.')
  })

  // fails if an editor answer with no reason, the same hook line, or a cover outside the reel reaches the screen
  it('refuses an editor answer that changes nothing or says nothing', () => {
    expect(parseTryProposal({ variable: 'cover', value: 7.5, reason: ' I picked your smile. ' }, first.caption, 20)).toEqual({ variable: 'cover', value: 7.5, reason: 'I picked your smile.' })
    expect(() => parseTryProposal({ variable: 'cover', value: 7.5 }, first.caption, 20)).toThrow(/reason/)
    expect(() => parseTryProposal({ variable: 'hook', value: 'Hi guys, quick one', reason: 'I kept it.' }, first.caption, 20)).toThrow(/same as Try 1/)
    expect(() => parseTryProposal({ variable: 'cover', value: 31, reason: 'I picked the end.' }, first.caption, 20)).toThrow(/inside the video/)
    expect(() => parseTryProposal({ variable: 'brightness', value: 0.5, reason: 'I lift it.' }, first.caption, 20)).toThrow(/too small or too large/)
  })

  // fails if the app's own pick lands on the current cover, which would make Try 2 the same as Try 1
  it('picks a cover a word end away from the current one', () => {
    const words = [{ s: 5.2, e: 5.6 }, { s: 11.6, e: 12.1 }, { s: 6.6, e: 7.1 }]
    expect(appCoverPick(20, words, null)).toBe(12.1)
    expect(appCoverPick(20, words, 12)).toBe(7.1)
  })
})
