import { describe, expect, it } from 'vitest'
import type { ProjectSummary } from '../src/shared/api'
import { activity, stateOf, stepWords } from '../src/renderer/src/screens/home-state'

const now = new Date('2026-10-23T12:00:00Z')
const reel = (slug: string, over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  slug,
  dir: `/r/${slug}`,
  title: slug,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-22T10:00:00Z',
  version: 0,
  thumbnail: null,
  status: 'ready',
  waiting: 0,
  noVideo: false,
  take: null,
  versionAt: null,
  series: null,
  pausedFor: null,
  failedWhy: null,
  posted: false,
  ...over
})
const slugs = (l: ProjectSummary[]) => l.map((p) => p.slug)
const limit = { reason: 'limit' as const, until: '2026-10-23T15:40:00Z', editor: 'Claude' }

describe('Activity on Reels (ux-foundation-b.md 3.4)', () => {
  // the list arrives newest first, so the reel waiting for a video is ahead of the ones that stopped
  const list = [
    reel('idea', { noVideo: true, status: 'planned' }),
    reel('made', { status: 'ready', version: 2, versionAt: '2026-10-22T09:00:00Z' }),
    reel('held', { status: 'interrupted', pausedFor: limit }),
    reel('stopped', { status: 'interrupted' }),
    reel('making', { status: 'working' }),
    reel('broke', { status: 'failed', failedWhy: 'No speech was heard in this video.' }),
    reel('old', { status: 'ready', version: 1, versionAt: '2026-09-01T09:00:00Z' })
  ]

  // fails if a reel that stopped sits behind one that never started, or a pause that goes on by itself asks for the person
  it('puts what stopped ahead of what never started, and what is being made ahead of what waits to continue', () => {
    const g = activity(list, now)
    expect(slugs(g.needs)).toEqual(['broke', 'stopped', 'idea'])
    expect(slugs(g.making)).toEqual(['making', 'held'])
    expect(slugs(g.recent)).toEqual(['made'])
  })

  it('keeps the list order among reels of the same rank', () => {
    const g = activity([reel('b', { status: 'failed' }), reel('a', { status: 'failed' })], now)
    expect(slugs(g.needs)).toEqual(['b', 'a'])
  })

  it('reads a planned reel as waiting for its video whatever app.json says', () => {
    expect(stateOf(reel('x', { noVideo: true, status: 'interrupted' }))).toBe('novideo')
    expect(stateOf(reel('x', { status: 'new' }))).toBe('making')
  })
})

describe("the Making row's step (Home.tsx Row)", () => {
  const steps = [
    { id: 'copy' as const, state: 'done' as const },
    { id: 'listen' as const, state: 'done' as const },
    { id: 'edit' as const, state: 'now' as const }
  ]
  // fails if the row names a step the Reel screen's strip doesn't: the strip names the wait while the editor is
  // waited on, and what a note's job says it is doing (Composer.tsx)
  it('names the current step, the editor wait, or a note job\'s own words, as the strip does', () => {
    expect(stepWords({ message: 'Picking takes', waiting: false, steps })).toBe('Picking takes and pictures')
    expect(stepWords({ message: 'Waiting for Claude', waiting: true, steps })).toBe('Waiting for Claude')
    expect(stepWords({ message: 'Double-checking your change', waiting: false })).toBe('Double-checking your change')
    expect(stepWords({ message: ' ', waiting: false })).toBeNull()
  })
})
