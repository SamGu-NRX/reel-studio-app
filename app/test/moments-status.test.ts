import { describe, expect, it } from 'vitest'
import { aiNoteText, forPerson, personText } from '../src/shared/moments'

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
        // bare ids go only when they are ones handed with this note (w0, w1, w2 here)
        { type: 'tool', name: 'zoom', summary: 'Zoom on w0 to w2' },
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

describe('personText', () => {
  // the practice editor's reply (main/ai-mock.ts) to a note with a range, as startNote saves it (main/index.ts)
  it("fails if a note's reply keeps the moment or word ids the AI was handed", () => {
    const text = 'make the subtitles bigger here'
    const ai = aiNoteText(text, { at: 6, to: 9, version: 1, words: ['w10', 'w11', 'w12'], quote: 'engine will write what you actually' })
    expect(personText(`Done: "${ai}". It is Version 2.`, ai, text)).toBe(`Done: "${text}". It is Version 2.`)
    // a real editor paraphrases instead of echoing: the wrapper and the ids still go
    expect(personText(`I made the subtitles bigger from 0:06 to 0:09 (around "engine will write", words w10, w11).`, ai, text)).toBe(
      'I made the subtitles bigger from 0:06 to 0:09.'
    )
  })
})

// Review finding r12: a bare "w\d+" rule stripped the person's own words ("Use w12 for the lower third").
describe("personText and the person's own w12", () => {
  const text = 'Use w12 for the lower third here'
  const ai = aiNoteText(text, { at: 6, version: 1, words: ['w10', 'w11'], quote: 'engine will write' })
  it('fails if an echo or a paraphrase loses an id-like word the person typed', () => {
    expect(personText(`Done: "${ai}". It is Version 2.`, ai, text)).toBe(`Done: "${text}". It is Version 2.`)
    expect(personText('I put w12 in the lower third on w10 to w11.', ai, text)).toBe('I put w12 in the lower third.')
  })
  it('fails if a bare id that was not handed with the note is taken for one', () => {
    expect(personText('Kept w40 as it was.', ai, text)).toBe('Kept w40 as it was.')
  })
})
