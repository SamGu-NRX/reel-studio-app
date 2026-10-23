// Edit it myself opened on a waiting hand edit (renderer screens/edit/session.ts): what the person changes there
// must survive that edit starting and landing while the panel is open.
import { describe, expect, it } from 'vitest'
import type { ProjectDetail, ProjectJson, QueuedNote, Word } from '../src/shared/api'
import { keptIds } from '../src/shared/cut'
import { applyHandEdit, diffProject } from '../src/shared/hand-edit'
import { follow, open } from '../src/renderer/src/screens/edit/session'

const words: Word[] = ['a', 'b', 'c', 'd'].map((w, i) => ({ id: `w${i + 1}`, w, s: i, e: i + 0.5 }))
const project = (keep: { from: string; to: string }[], version = 1): ProjectJson =>
  ({ schemaVersion: 1, id: 'p', title: 't', slug: 's', createdAt: '', updatedAt: '', version, cut: { keep } }) as ProjectJson
const detail = (p: ProjectJson, queue: QueuedNote[]): ProjectDetail => ({ slug: 's', words, project: p, queue }) as unknown as ProjectDetail
const kept = (p: ProjectJson) => new Set(keptIds(words, p.cut?.keep))

describe('Edit it myself on a waiting edit', () => {
  it('fails if bringing back a word the waiting edit cut is lost once that edit lands', () => {
    const v1 = project([{ from: 'w1', to: 'w4' }])
    const cutB = new Set(kept(v1))
    cutB.delete('w2')
    const entry: QueuedNote = { id: 'h1', text: 'cut b', attachments: [], seenVersion: 1, hand: { edit: diffProject(v1, v1, kept(v1), cutB), changes: 1 } }
    let s = open(detail(v1, [entry]), entry)
    // the person brings "b" back and cuts "c" instead
    const now = s.history[s.history.length - 1]
    const mine = new Set(now.kept)
    mine.add('w2')
    mine.delete('w3')
    s = { ...s, history: [...s.history, { p: now.p, kept: mine }] }
    // the waiting edit starts, then lands as Version 2
    s = follow(s, detail(v1, [{ ...entry, attempt: { base: 1 } }]))
    const v2 = { ...applyHandEdit(v1, entry.hand!.edit, words), version: 2 }
    s = follow(s, detail(v2, []))
    expect([...s.history[s.history.length - 1].kept]).toEqual(['w1', 'w2', 'w4'])
  })
})
