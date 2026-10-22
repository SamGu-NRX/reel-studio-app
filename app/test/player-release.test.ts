import { describe, expect, it, vi } from 'vitest'
import { releaseVideo } from '../src/renderer/src/components/media-release'

describe('player media cleanup', () => {
  it('pauses and clears src before the element is discarded', () => {
    const pause = vi.fn()
    const removeAttribute = vi.fn()
    const load = vi.fn()
    releaseVideo({ pause, removeAttribute, load })
    expect(pause).toHaveBeenCalledOnce()
    expect(removeAttribute).toHaveBeenCalledWith('src')
    expect(load).toHaveBeenCalledOnce()
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(removeAttribute.mock.invocationCallOrder[0])
    expect(removeAttribute.mock.invocationCallOrder[0]).toBeLessThan(load.mock.invocationCallOrder[0])
  })
})
