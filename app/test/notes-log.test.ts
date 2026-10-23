import { describe, expect, it } from 'vitest'
import type { ChatMessage, VersionInfo } from '../src/shared/api'
import { notesLog } from '../src/shared/notes-log'

const now = new Date('2026-10-22T15:00:00')
const at = (h: number, day = 22) => new Date(2026, 9, day, h).toISOString()
const v = (n: number, day = 22): VersionInfo => ({ n, parent: n > 1 ? n - 1 : null, video: '', videoPath: '', draft: false, cover: null, createdAt: at(9, day) })
let id = 0
const msg = (from: ChatMessage['from'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: `m${++id}`, from, text, at: at(10), ...extra })

describe('notesLog', () => {
  it('pairs each note with what came of it, in order, with the running one last', () => {
    const chat = [
      { ...msg('editor', 'Your video is ready.', { version: 1 }), at: at(9, 21) },
      msg('you', 'cut the part about my cat', { jobId: 'j1', outcome: 'done', moment: { at: 12, version: 1, words: ['w1'], quote: 'my cat' } }),
      msg('editor', 'Cut 0:12 to 0:15.', { version: 2 }),
      msg('you', 'make it brighter', { jobId: 'j2', outcome: 'failed' }),
      msg('editor', 'Your AI editor stopped answering.'),
      msg('you', 'add music', { jobId: 'j3', outcome: 'stopped' }),
      msg('editor', 'Version 3: bigger subtitles.', { version: 3 }),
      msg('you', 'zoom in on me', { jobId: 'j4' })
    ]
    const log = notesLog({
      chat,
      made: [{ version: 3, by: 'hand', summary: 'the subtitles', at: at(10) }],
      versions: [v(1, 21), v(2), v(3)],
      running: { id: 'j4', kind: 'note' },
      // fails if the line names the copy Reel Studio made (media/take01.mov) instead of the file the person brought in
      source: { path: 'media/take01.mov', originalName: 'IMG_2207.MOV' },
      now
    })
    expect(log.map((e) => [e.day, e.ask.kind, e.ask.text, e.result])).toEqual([
      ['Yesterday', 'video', 'Your video, IMG_2207.MOV', { kind: 'version', v: 1, text: 'Your video is ready.' }],
      ['Today', 'note', 'cut the part about my cat', { kind: 'version', v: 2, text: 'Cut 0:12 to 0:15.' }],
      [null, 'note', 'make it brighter', { kind: 'failed', text: 'Your AI editor stopped answering.' }],
      [null, 'note', 'add music', { kind: 'stopped', kept: 3 }],
      [null, 'hand', 'You changed the subtitles', { kind: 'version', v: 3, text: 'Version 3: bigger subtitles.' }],
      [null, 'note', 'zoom in on me', { kind: 'making', v: 4 }]
    ])
    expect(log[1].ask).toMatchObject({ moment: { at: 12 } })
  })

  it('shows the no-AI answer as the note’s reply, with its buttons', () => {
    const log = notesLog({
      chat: [msg('editor', 'Ready.', { version: 1 }), msg('you', 'bigger subtitles'), msg('editor', 'I can’t change that without an AI editor.', { actions: ['open-captions'] })],
      made: [],
      versions: [v(1)],
      running: null,
      source: null,
      now
    })
    expect(log[1].result).toMatchObject({ kind: 'reply', actions: ['open-captions'] })
  })

  // fails if a planned reel shows a video it does not have, or its script moves below the video once one arrives
  it('puts the planning first: the idea, then the script, with no video until there is one', () => {
    const script = { hook: 'No mixer.', script: 'Flour, water, salt.', onScreenText: [] }
    const planning = [
      msg('you', 'sourdough without a mixer', { plan: true, jobId: 's1', outcome: 'done' }),
      msg('editor', 'No mixer.', { plan: true, script }),
      msg('you', 'shorter please', { plan: true, jobId: 's2' })
    ]
    const base = { made: [], source: null, now }
    expect(notesLog({ ...base, chat: planning, versions: [], running: { id: 's2', kind: 'script' }, planned: true }).map((e) => [e.ask.text, e.result])).toEqual([
      ['sourdough without a mixer', { kind: 'script', script }],
      ['shorter please', { kind: 'writing' }]
    ])
    const filmed = notesLog({ ...base, chat: [...planning.slice(0, 2), msg('editor', 'Here it is.', { version: 1 })], versions: [v(1)], running: null })
    expect(filmed.map((e) => [e.ask.kind, e.result?.kind])).toEqual([
      ['note', 'script'],
      ['video', 'version']
    ])
  })
})
