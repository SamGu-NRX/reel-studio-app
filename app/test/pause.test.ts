import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPauser, pauseFor, quitQuestion } from '../src/main/pause'
import { pausedSentence, pausedWords } from '../src/shared/pause'

describe('pauseFor: what pauses instead of failing (ux-foundation-b.md 3.4, 7)', () => {
  const ctx = { kind: 'first-edit' as const, online: true, slept: false, editor: 'Claude' }
  // fails if a plan limit, no internet or sleep is reported as "Didn't finish", or a real failure is called a pause
  it('pauses Version 1 for a plan limit, no internet or sleep, and nothing else', () => {
    const until = '2026-10-23T20:40:00.000Z'
    expect(pauseFor({ code: 'cli_limited', resetsAt: until }, ctx)).toEqual({ reason: 'limit', until, editor: 'Claude' })
    expect(pauseFor({ code: 'chatgpt_usage_limit' }, ctx)).toEqual({ reason: 'limit', until: null, editor: 'Claude' })
    expect(pauseFor({ code: 'cli_limited', resetsAt: 'soon' }, ctx)).toMatchObject({ until: null })
    expect(pauseFor({ code: 'cli_error' }, { ...ctx, online: false })).toMatchObject({ reason: 'offline' })
    expect(pauseFor({ code: 'cli_timeout' }, { ...ctx, slept: true })).toMatchObject({ reason: 'sleep' })
    expect(pauseFor({ code: 'ENGINE_FAILED' }, ctx)).toBeNull()
    expect(pauseFor(new Error('boom'), ctx)).toBeNull()
  })
  it('pauses a note only for a plan limit: offline, a note says it did not finish (B section 7)', () => {
    const note = { ...ctx, kind: 'note' as const, online: false, slept: true }
    expect(pauseFor({ code: 'cli_limited' }, note)).toMatchObject({ reason: 'limit' })
    expect(pauseFor({ code: 'cli_error' }, note)).toBeNull()
  })
})

describe('createPauser: it goes on by itself', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const setup = () => {
    let online = true
    const resumed: string[] = []
    const p = createPauser({ online: () => online, resume: async (s) => void resumed.push(s), log: () => undefined, marginMs: 30_000 })
    return { p, resumed, goOffline: () => (online = false), goOnline: () => (online = true) }
  }

  // fails if a reel paused at its plan limit continues before the reset, or never does
  it('continues a plan limit 30 s after its reset time, or tries again every 15 minutes when none was given', () => {
    const { p, resumed } = setup()
    const now = Date.now()
    p.schedule('a', { reason: 'limit', until: new Date(now + 60_000).toISOString(), editor: null }, now)
    p.schedule('b', { reason: 'limit', until: null, editor: null }, now)
    vi.advanceTimersByTime(89_000)
    expect(resumed).toEqual([])
    vi.advanceTimersByTime(2_000)
    expect(resumed).toEqual(['a'])
    vi.advanceTimersByTime(15 * 60_000)
    expect(resumed).toEqual(['a', 'b'])
  })

  // fails if "Waiting for internet" never notices the network is back, or sleep never continues on wake
  it('continues no-internet once online, sleep on wake (or once online), a quit at once; a cancelled one never', () => {
    const { p, resumed, goOffline, goOnline } = setup()
    goOffline()
    p.schedule('net', { reason: 'offline', until: null, editor: null })
    p.schedule('nap', { reason: 'sleep', until: null, editor: null })
    p.schedule('gone', { reason: 'offline', until: null, editor: null })
    p.cancel('gone')
    vi.advanceTimersByTime(20_000)
    expect(resumed).toEqual([])
    p.woke() // awake but still offline: sleep now waits for the network too
    goOnline()
    vi.advanceTimersByTime(5_000)
    expect(resumed.sort()).toEqual(['nap', 'net'])
    p.schedule('quit', { reason: 'quit', until: null, editor: null })
    expect(resumed).toContain('quit')
    expect(p.pending()).toEqual([])
  })
})

describe('the words of a pause', () => {
  const now = new Date(2026, 9, 23, 14, 0)
  it('say when it continues, or what it waits for, and whose plan', () => {
    const at = new Date(2026, 9, 23, 15, 40).toISOString()
    const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    expect(pausedWords({ reason: 'limit', until: at, editor: 'Claude' }, now, 'Mac')).toBe(`Continues at ${time}`)
    expect(pausedWords({ reason: 'limit', until: new Date(2026, 9, 24, 9).toISOString(), editor: null }, now, 'Mac')).toBe('Continues tomorrow')
    expect(pausedWords({ reason: 'offline', until: null, editor: null }, now, 'Mac')).toBe('Waiting for internet')
    expect(pausedWords({ reason: 'sleep', until: null, editor: null }, now, 'PC')).toBe('Continues when your PC wakes')
    expect(pausedSentence({ reason: 'limit', until: at, editor: 'Claude' }, now, 'Mac')).toBe(`Your Claude plan is at its limit. It resets at ${time}, and this continues then.`)
    expect(pausedSentence({ reason: 'limit', until: null, editor: null }, now, 'Mac')).toBe('Your plan is at its limit. This continues when it resets.')
  })
  it('asks once before a quit, counting the reels being made', () => {
    expect(quitQuestion(0)).toBeNull()
    expect(quitQuestion(1)?.message).toBe('1 reel is still being made. Quit and continue it next time?')
    expect(quitQuestion(2)?.message).toBe('2 reels are still being made. Quit and continue them next time?')
  })
})
