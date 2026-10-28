import { describe, expect, it } from 'vitest'
import { momentToSend, pointsAtScreen } from '../src/shared/composer'

describe('the moment a note carries', () => {
  // fails if a note sent after the person paused on a moment goes out without it (finding 3 of the 10-28 audit)
  it('is the playhead once the person stopped on a moment, whatever the note says', () => {
    expect(momentToSend(null, { auto: true, text: 'make the subtitles bigger', at: 6.4 })).toEqual({ at: 6.4 })
  })

  // fails if "make the subtitles bigger here" goes out with no moment because nobody clicked the offer
  it('is the playhead for a note that says here, this or now', () => {
    for (const text of ['make the subtitles bigger here', 'cut this part', 'Zoom in now']) {
      expect(momentToSend(null, { auto: false, text, at: 6 })).toEqual({ at: 6 })
    }
  })

  it('is the whole reel for a note about the whole reel', () => {
    // "there" and "nowhere" hold the words without meaning them
    for (const text of ['make the hook punchier', 'make this reel shorter', 'there is a typo', 'nowhere near loud enough']) {
      expect(pointsAtScreen(text)).toBe(false)
      expect(momentToSend(null, { auto: false, text, at: 6 })).toBeNull()
    }
  })

  it('is the one the person set, over the playhead', () => {
    const range = { at: 2, to: 5 }
    expect(momentToSend(range, { auto: true, text: 'here', at: 9 })).toBe(range)
  })
})
