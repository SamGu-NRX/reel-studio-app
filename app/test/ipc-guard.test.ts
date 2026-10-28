import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { assertIpcSender, validateIpcArgs } from '../src/main/ipc-guard'
import { APP_DIR, PYTHON } from './helpers'

afterEach(() => vi.unstubAllGlobals())

it('accepts Cover edits built from the real engine new_project defaults', () => {
  const project = JSON.parse(execFileSync(PYTHON, ['-c',
    'import json; from reelengine.project import new_project; print(json.dumps(new_project("Fresh take")))'
  ], { cwd: join(APP_DIR, '..'), env: { ...process.env, PYTHONPATH: join(APP_DIR, '..', 'engine') }, encoding: 'utf8' }))
  for (const cover of [project.cover, { ...project.cover, atSourceTime: 4 }, { ...project.cover, text: 'Day 3' }, null, {}]) {
    expect(() => validateIpcArgs('projects:update', [project.slug, { cover }])).not.toThrow()
  }
  for (const cover of [{ atSourceTime: -1 }, { atSourceTime: NaN }, { source: 42 }, { text: false }, { exact: 'yes' }]) {
    expect(() => validateIpcArgs('projects:update', [project.slug, { cover }])).toThrow()
  }
})

it('accepts a b-roll item with no optional asset or params, while rejecting malformed items', () => {
  const broll = [{ id: 'b1', anchor: { from: 'w1', to: 'w2' }, treatment: 'text-pop' }]
  expect(() => validateIpcArgs('projects:update', ['fresh-take', { broll }])).not.toThrow()
  expect(() => validateIpcArgs('projects:update', ['fresh-take', { broll: [{ ...broll[0], asset: 42 }] }])).toThrow()
  expect(() => validateIpcArgs('projects:update', ['fresh-take', { broll: [{ ...broll[0], params: null }] }])).toThrow()
})

function sender(actual: string): { event: IpcMainInvokeEvent; contents: WebContents } {
  const mainFrame = { url: actual }
  const contents = { isDestroyed: () => false, mainFrame } as WebContents
  const event = { sender: contents, senderFrame: mainFrame } as IpcMainInvokeEvent
  return { event, contents }
}

it('accepts equivalent packaged renderer paths with different URL escaping', () => {
  const expected = pathToFileURL(join(APP_DIR, 'Reel [preview].app', 'index.html')).href
  const actual = expected.replace(/%5B/gi, '[').replace(/%5D/gi, ']')
  const { event, contents } = sender(actual)
  expect(() => assertIpcSender(event, contents, expected)).not.toThrow()
  expect(() => assertIpcSender(event, contents, expected.replace('index.html', 'other.html'))).toThrow()
})

it('compares packaged renderer paths without case differences on Windows', () => {
  vi.stubGlobal('process', { ...process, platform: 'win32' })
  const { event, contents } = sender('file:///C:/Program%20Files/Reel/index.html')
  expect(() => assertIpcSender(event, contents, 'file:///c:/program%20files/reel/index.html')).not.toThrow()
  expect(() => assertIpcSender(event, contents, 'file:///c:/program%20files/reel/other.html')).toThrow()
})

// version-tree and version-merge: the page names saved versions by number and a side per layer, nothing else
it('fails if a branched note or a merge request with a bad version number or side gets past the guard', () => {
  const take = { cut: 'ours', captions: 'theirs', music: 'ours', zooms: 'ours', broll: 'ours', sfx: 'ours', cover: 'ours' }
  expect(() => validateIpcArgs('projects:note', ['reel', 'slower', [], undefined, 2, 1])).not.toThrow()
  for (const base of [0, 1.5, '1', -1]) expect(() => validateIpcArgs('projects:note', ['reel', 'slower', [], undefined, 2, base])).toThrow()
  expect(() => validateIpcArgs('projects:mergeVersions', ['reel', { ours: 1, theirs: 2, take }])).not.toThrow()
  expect(() => validateIpcArgs('projects:mergeVersions', ['reel', { ours: 0, theirs: 2, take }])).toThrow()
  expect(() => validateIpcArgs('projects:mergeVersions', ['reel', { ours: 1, theirs: 2, take: { ...take, cut: 'both' } }])).toThrow()
  expect(() => validateIpcArgs('projects:mergeVersions', ['reel', { ours: 1, theirs: 2 }])).toThrow()
  expect(() => validateIpcArgs('projects:mergeVersions', ['../reel', { ours: 1, theirs: 2, take }])).toThrow()
})

// ui-plan-chat: the planning chat's text and the plan link's reel name are checked like every other reel call
it('fails if a planning-chat turn that is not text, or a plan link for a path outside the library, gets past the guard', () => {
  expect(() => validateIpcArgs('projects:planSay', ['reel', 'a reel about bread'])).not.toThrow()
  expect(() => validateIpcArgs('projects:planSay', ['reel', { text: 'bread' }])).toThrow()
  expect(() => validateIpcArgs('phone:startPlan', ['reel'])).not.toThrow()
  expect(() => validateIpcArgs('phone:startPlan', ['../reel'])).toThrow()
})

// #90: the Connect cards' four calls name one of the two vendors and nothing else
it('fails if a Connect call for anything but Claude or ChatGPT gets past the guard', () => {
  for (const channel of ['ai:vendorStatus', 'ai:vendorConnect', 'ai:vendorCancel', 'ai:vendorSignInAgain', 'ai:vendorSignInWithCode', 'ai:vendorSignIn']) {
    expect(() => validateIpcArgs(channel, ['claude'])).not.toThrow()
    expect(() => validateIpcArgs(channel, ['chatgpt'])).not.toThrow()
    expect(() => validateIpcArgs(channel, ['codex'])).toThrow()
    expect(() => validateIpcArgs(channel, [{ vendor: 'claude' }])).toThrow()
  }
})

// more reels: a pick names one to five of the proposal's candidates, each once; Not now and Show say which
it('fails if a pick of reels that is not 1 to 5 candidate ids, or a fold that is not yes or no, gets past the guard', () => {
  expect(() => validateIpcArgs('projects:makeReels', ['reel', ['r1', 'r3']])).not.toThrow()
  for (const ids of [[], ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], ['r1', 'r1'], ['../reel'], ['r1x'], 'r1'])
    expect(() => validateIpcArgs('projects:makeReels', ['reel', ids])).toThrow()
  expect(() => validateIpcArgs('projects:makeReels', ['../reel', ['r1']])).toThrow()
  expect(() => validateIpcArgs('projects:foldReels', ['reel', true])).not.toThrow()
  expect(() => validateIpcArgs('projects:foldReels', ['reel', 'yes'])).toThrow()
})
