import { expect, it } from 'vitest'
import { noteOutcome } from '../src/main/note-queue'

// A note that changes nothing did not do what it was asked (Try again). One that asked to remember a rule did: the
// question is its answer, and Try again would only ask again.
it('fails if a note that only asks to remember a rule counts as one that did not finish', () => {
  expect(noteOutcome(1, { version: 1, changed: [] })).toBe('failed')
  expect(noteOutcome(1, { version: 2, changed: [] })).toBe('done')
  expect(noteOutcome(1, { version: 1, changed: ['captions'] })).toBe('done')
  expect(noteOutcome(1, { version: 1, changed: [], styleSuggestions: ['Always use big subtitles.'] })).toBe('done')
  expect(noteOutcome(1, { changed: [], styleProposal: { id: 'p', text: 'Use lowercase subtitles.' } as never })).toBe('done')
  expect(noteOutcome(1, { changed: [], styleSuggestions: [] })).toBe('failed')
})
