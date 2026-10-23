import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../src/shared/api'
import { checkPlan, planAsScript, planCounts, planFromEditor, planText, planTurns, titleFromTopic } from '../src/shared/plan'

const PLAN = { topic: 'Sourdough', hooks: ['No mixer.', 'A year by hand.'], hook: 1, beats: [{ text: 'Flour, water, salt.' }, { text: 'Fold it.', done: true }], shots: [{ text: 'Me at the counter' }] }

describe('checkPlan', () => {
  it('keeps a well-formed plan as it is, with whitespace tidied', () => {
    expect(checkPlan({ ...PLAN, beats: [{ text: '  Flour,\n water, salt. ' }, { text: 'Fold it.', done: true }] })).toEqual(PLAN)
  })

  // fails if a plan the Plan card or the form could not have made is saved anyway
  it('refuses, saying why, anything else', () => {
    const no = (p: unknown) => {
      try {
        checkPlan(p)
      } catch (e) {
        return (e as { code: string; userMessage: string }).userMessage
      }
      return 'saved'
    }
    expect(no(null)).toBe('There is no plan to save.')
    expect(no({ ...PLAN, hooks: [] })).toBe('A plan has 1 to 3 hooks.')
    expect(no({ ...PLAN, hook: 2 })).toBe('No hook is picked.')
    expect(no({ ...PLAN, beats: [] })).toBe('A plan has 1 to 6 beats.')
    expect(no({ ...PLAN, beats: [{ text: ' ' }] })).toBe('Line 1 of the beats is empty.')
    expect(no({ ...PLAN, shots: Array(7).fill({ text: 'x' }) })).toBe('A plan has 0 to 6 shots.')
    expect(no({ ...PLAN, shots: [{ text: 'x'.repeat(161) }] })).toBe('Line 1 of the shots is longer than 160 characters.')
    expect(no({ ...PLAN, beats: [{ text: 'x', done: 'yes' }] })).toBe('Line 1 of the beats is neither done nor to do.')
    expect(no({ ...PLAN, topic: 3 })).toBe("What it's about is missing.")
  })
})

it('turns the editor proposal into a plan with its first hook picked', () => {
  expect(planFromEditor('Sourdough', { hooks: ['A', 'B'], beats: ['one', 'two', 'three'], shots: ['s'] })).toEqual({
    topic: 'Sourdough',
    hooks: ['A', 'B'],
    hook: 0,
    beats: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
    shots: [{ text: 's' }]
  })
})

// fails if the first edit gets a hook other than the picked one, or the beats lose their order
it('gives the first edit the picked hook, the beats in order and the shots', () => {
  expect(planAsScript(PLAN)).toEqual({ hook: 'A year by hand.', script: 'Flour, water, salt.\nFold it.', shots: ['Me at the counter'] })
})

it('reads as plain text for Copy and the phone', () => {
  expect(planText(PLAN, 'Bread')).toBe('Bread\n\nHook: A year by hand.\n\nBeats\n1. Flour, water, salt.\n2. Fold it.\n\nShots\n- Me at the counter')
  expect(planCounts(PLAN)).toBe('2 beats, 1 shot')
  expect(planCounts({ ...PLAN, shots: [] })).toBe('2 beats')
  expect(titleFromTopic('how I make sourdough bread at home without a stand mixer or any gear')).toBe('How I make sourdough bread at home without a')
})

// fails if words the creator stopped are sent again, or the editor's questions are not counted
it('gives the editor the chat so far and counts its questions', () => {
  let id = 0
  const m = (from: ChatMessage['from'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `${++id}`, from, text, at: '', plan: true, ...extra })
  const chat = [
    m('you', 'sourdough', { outcome: 'done' }),
    m('editor', 'Who is it for?', { planTurn: 'question' }),
    m('you', 'oops', { outcome: 'stopped' }),
    m('you', 'beginners', { outcome: 'failed' }),
    m('editor', 'Claude stopped answering.'),
    m('you', 'beginners'),
    { ...m('you', 'a note after the video'), plan: undefined }
  ]
  expect(planTurns(chat)).toEqual({
    turns: [
      { from: 'you', text: 'sourdough' },
      { from: 'editor', text: 'Who is it for?', kind: 'question' },
      { from: 'you', text: 'beginners' }
    ],
    asked: 1
  })
})
