import { describe, expect, it, vi } from 'vitest'
import type { ProviderStatus } from '../src/main/ai-types'
import { proposeTry } from '../src/main/try-proposal'

// Version 2 plays take s1 from 4 s: source 9 s is 5 s into the reel.
const timeline = {
  duration: 20,
  words: [{ id: 'w1', w: 'Nobody', s: 0.42, e: 0.8 }, { id: 'w2', w: 'knows', s: 11.6, e: 12.1 }],
  segments: [{ source: 's1', src_start: 4, src_end: 24, out_start: 0 }]
}
const caption = 'Hi guys\nOne bowl.'
const connected: ProviderStatus = { id: 'claude-cli', connected: true, label: 'Claude' }
const none: ProviderStatus = { id: 'none', connected: true, label: 'No AI' }

describe('Try 2 proposal', () => {
  // fails if the app speaks as the editor, or asks an editor that isn't there
  it('without an editor, the app picks another cover and gives no reason', async () => {
    const editor = vi.fn()
    const r = await proposeTry({ ai: { active: async () => none, proposeTry: editor }, caption, timeline, cover: null, log: () => {} })
    expect(r).toEqual({ proposal: { variable: 'cover', value: 12.1, reason: null } })
    expect(editor).not.toHaveBeenCalled()
  })

  // fails if the editor reads the cover on the raw take's clock, or the creator's swap is dropped on the way
  it('asks the connected editor with the cover on the reel\'s clock and the swapped thing', async () => {
    const editor = vi.fn(async () => ({ variable: 'caption', value: 'Mix, wait, fold.', reason: 'I give the steps.' }))
    const r = await proposeTry({ ai: { active: async () => connected, proposeTry: editor }, caption, variable: 'caption', timeline, cover: { source: 's1', atSourceTime: 9 }, log: () => {} })
    expect(r).toEqual({ proposal: { variable: 'caption', value: 'Mix, wait, fold.', reason: 'I give the steps.' } })
    expect(editor).toHaveBeenCalledWith({ caption, duration: 20, coverSeconds: 5, variable: 'caption', words: [{ w: 'Nobody', s: 0.4 }, { w: 'knows', s: 11.6 }] })
  })

  // fails if a failed or unusable answer leaves the creator with nothing, or with the editor's words unchecked
  it('falls back to the app\'s cover, and says so, when the editor fails or answers the wrong thing', async () => {
    const log = vi.fn()
    const failed = await proposeTry({ ai: { active: async () => connected, proposeTry: async () => { throw { code: 'cli_limited', userMessage: 'Your plan is at its limit.' } } }, caption, timeline, cover: null, log })
    expect(failed).toEqual({ proposal: { variable: 'cover', value: 12.1, reason: null }, notice: "The editor didn't choose Try 2 this time, so it uses another cover." })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Your plan is at its limit.'))
    const wrong = await proposeTry({ ai: { active: async () => connected, proposeTry: async () => ({ variable: 'hook', value: 'New', reason: 'I lead.' }) }, caption, variable: 'brightness', timeline, cover: null, log })
    expect(wrong.proposal.reason).toBeNull()
  })
})
