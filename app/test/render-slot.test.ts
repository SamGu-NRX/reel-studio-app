import { describe, expect, it } from 'vitest'
import type { RunEngine } from '../src/main/engine'
import { withRenderSlot } from '../src/main/render-slot'

// The model check releases the work gate from onExit (models.ts). A wrapper that drops it leaves the
// gate held, and a fresh profile's first video waits at "Getting started" forever.
describe('withRenderSlot', () => {
  for (const command of ['speech-check', 'render']) {
    it(`passes onExit through for ${command}`, async () => {
      const inner: RunEngine = async (_c, _a, _p, _s, onExit) => {
        onExit?.()
        return null
      }
      let exited = false
      await withRenderSlot(inner, () => undefined)(command, [], undefined, undefined, () => (exited = true))
      expect(exited).toBe(true)
    })
  }
})
