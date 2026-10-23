import { describe, expect, it } from 'vitest'
import { aiNoteText, forPerson } from '../src/shared/moments'

type Ev = { type: 'status'; message: string } | { type: 'tool'; name: string; summary: string } | { type: 'reply'; text: string }

// What reaches the progress card while a note with a moment runs.
function shown(events: Ev[], text: string, words = ['w0', 'w1', 'w2']): string[] {
  const ai = aiNoteText(text, { at: 0, version: 3, words, quote: 'this is placeholder' })
  const out: string[] = []
  const emit = forPerson((e: Ev) => out.push(e.type === 'status' ? e.message : e.type === 'tool' ? e.summary : e.text), ai, text)
  for (const e of events) emit(e)
  return out
}

describe('forPerson', () => {
  const text = 'zoom in on me here'
  const ai = aiNoteText(text, { at: 0, version: 3, words: ['w0', 'w1', 'w2'], quote: 'this is placeholder' })
  it('is what the progress card got before the fix', () => expect(ai).toBe('At 0:00 (around "this is placeholder", words w0, w1, w2): zoom in on me here'))

  it("puts the person's own words back in the practice editor's status line", () => {
    expect(shown([{ type: 'status', message: `Working on "${ai}"` }], text)).toEqual([`Working on "${text}"`])
  })

  it('lets no word id or moment wrapper through, wherever it appears', () => {
    const lines = shown(
      [
        { type: 'status', message: `Reading ${ai}` },
        { type: 'status', message: 'Zooming at words w12, w13 (around "you don\'t need a mixer")' },
        { type: 'tool', name: 'zoom', summary: 'Zoom on w7 to w9' },
        { type: 'status', message: 'At 0:14 (around "flour", words w80, w81): cut this part' }
      ],
      text
    )
    for (const l of lines) {
      expect(l).not.toMatch(/\bw\d+\b/)
      expect(l).not.toMatch(/\(around /)
    }
  })

  it('leaves ordinary status lines and replies alone', () => {
    expect(shown([{ type: 'status', message: 'Making the final video' }, { type: 'reply', text: 'Done.' }], text)).toEqual(['Making the final video', 'Done.'])
  })
})
