import { expect, it } from 'vitest'
import { showsFirstRun } from '../src/main/settings'

it('fails if Reset first run shows it in the middle of this launch, misses the next one, or a new install skips it', () => {
  // a new install
  expect(showsFirstRun({ firstRunDone: false, firstRunAgain: false }, false)).toBe(true)
  // set up, nothing reset
  expect(showsFirstRun({ firstRunDone: true, firstRunAgain: false }, false)).toBe(false)
  // reset during this launch: not until the next one
  expect(showsFirstRun({ firstRunDone: true, firstRunAgain: true }, false)).toBe(false)
  // the next launch
  expect(showsFirstRun({ firstRunDone: true, firstRunAgain: true }, true)).toBe(true)
  // that first run finished (firstRunAgain cleared)
  expect(showsFirstRun({ firstRunDone: true, firstRunAgain: false }, true)).toBe(false)
})
