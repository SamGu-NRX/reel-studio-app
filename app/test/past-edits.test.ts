import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countsOf, findPastEdits } from '../src/main/past-edits'
import { validateIpcArgs } from '../src/main/ipc-guard'
import { makePastEditsHome } from '../e2e/past-edits-home'

const fresh = (): string => mkdtempSync(join(tmpdir(), 'past-edits-'))
const shape = (found: Awaited<ReturnType<typeof findPastEdits>>) => found.map((f) => [f.file, f.app, f.kind, f.readable, f.where])

describe('Learn from my past edits: finding them', () => {
  it('finds each editor’s exports, libraries and projects where they are kept, newest first, and leaves out copies', async () => {
    const home = fresh()
    makePastEditsHome(home)
    expect(shape(await findPastEdits({ platform: 'darwin', home, spotlight: null }))).toEqual([
      ['Spring launch.fcpxml', 'Final Cut Pro', 'fcpxml', true, 'Movies › Exports'],
      ['Untitled.fcpbundle', 'Final Cut Pro', 'fcpbundle', false, 'Movies'],
      ['talking-head.xml', 'Premiere Pro', 'premiere-xml', true, 'Desktop'],
      ['Interview.prproj', 'Premiere Pro', 'prproj', false, 'Documents › Adobe › Premiere Pro › 26.0'],
      ['Kitchen tour.fcpxmld', 'Final Cut Pro', 'fcpxmld', true, 'Movies › Exports']
    ])
  })

  it('adds what Spotlight finds on another drive, but nothing from system folders or inside a bundle', async () => {
    const home = fresh()
    const drive = fresh()
    mkdirSync(join(drive, 'Edits', 'Big day.fcpbundle'), { recursive: true })
    mkdirSync(join(drive, 'Edits', 'Cut.fcpxmld'), { recursive: true })
    writeFileSync(join(drive, 'Edits', 'Cut.fcpxmld', 'Info.fcpxml'), '<fcpxml/>')
    const asked: string[] = []
    const found = await findPastEdits({
      platform: 'darwin',
      home,
      spotlight: async (q) => {
        asked.push(q)
        return [join(drive, 'Edits', 'Big day.fcpbundle'), join(drive, 'Edits', 'Cut.fcpxmld', 'Info.fcpxml'), '/Library/Application Support/Sample.fcpxml']
      }
    })
    expect(found.map((f) => f.file)).toEqual(['Big day.fcpbundle'])
    expect(asked).toHaveLength(2)
  })

  it('keeps the same id for the same file across looks, so ticks survive a refresh', async () => {
    const home = fresh()
    makePastEditsHome(home)
    const a = await findPastEdits({ platform: 'darwin', home, spotlight: null })
    const b = await findPastEdits({ platform: 'darwin', home, spotlight: null })
    expect(b.map((f) => f.id)).toEqual(a.map((f) => f.id))
    expect(new Set(a.map((f) => f.id)).size).toBe(a.length)
  })

  it('pairs reference-scan’s counts and reasons back to the edits by path, and refuses another shape', () => {
    const edit = (id: string, path: string) => ({ id, path, name: id, file: id, where: '', app: 'Premiere Pro' as const, kind: 'premiere-xml' as const, modified: '', readable: true })
    const found = [edit('a', '/x/a.xml'), edit('b', '/x/b.xml')]
    expect(countsOf(found, { files: [{ path: '/x/a.xml', timelines: 2 }, { path: '/x/b.xml', error: { code: 'NO_TIMELINE', message: 'No timeline.' } }, { path: '/elsewhere.xml', timelines: 1 }] })).toEqual({
      a: { timelines: 2 },
      b: { problem: 'No timeline.' }
    })
    expect(() => countsOf(found, { timelines: 1 })).toThrow('reference-scan returned no files list')
  })

  it('takes found edits by id only, never a path from the page', () => {
    expect(() => validateIpcArgs('style:learn', [['0123456789abcdef']])).not.toThrow()
    expect(() => validateIpcArgs('style:learn', [])).not.toThrow()
    expect(() => validateIpcArgs('style:learn', [['/Users/someone/secret.xml']])).toThrow()
    expect(() => validateIpcArgs('style:learn', [[]])).toThrow()
    expect(() => validateIpcArgs('style:reveal', ['/etc/passwd'])).toThrow()
  })
})
