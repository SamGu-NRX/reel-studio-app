import { expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { protocol } from 'electron'
import { createLiveVideos } from './.symlink-main/live-video'
import { handleMediaProtocol } from './.symlink-main/media'

vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }))

it('main serves ordinary preview and final through a symlinked projects root', async () => {
  const home = mkdtempSync(join(tmpdir(), 'rs-symlink-main-'))
  try {
    const real = join(home, 'real-projects')
    const root = join(home, 'linked-projects')
    mkdirSync(real)
    symlinkSync(real, root, 'junction')
    const dir = join(root, 'video')
    const draft = join(dir, 'versions/preview/draft.mp4')
    const final = join(dir, 'versions/v1/export.mp4')
    mkdirSync(join(dir, 'versions/preview'), { recursive: true })
    mkdirSync(join(dir, 'versions/v1'))
    writeFileSync(draft, 'preview bytes')
    writeFileSync(final, 'final bytes')
    const live = createLiveVideos()
    handleMediaProtocol(() => [root])
    const handler = vi.mocked(protocol.handle).mock.calls.at(-1)![1]
    const previewUrl = await live(dir, { type: 'render', version: 0, draft: true, file: realpathSync(draft) })
    const finalUrl = await live(dir, { type: 'render', version: 1, draft: false, file: realpathSync(final) })
    expect(previewUrl).not.toBeNull()
    expect(finalUrl).not.toBeNull()
    const preview = await handler(new Request(previewUrl!, { headers: { Range: 'bytes=0-6' } }))
    const published = await handler(new Request(finalUrl!, { headers: { Range: 'bytes=0-4' } }))
    expect(preview.status).toBe(206)
    expect(await preview.text()).toBe('preview')
    expect(published.status).toBe(206)
    expect(await published.text()).toBe('final')
  } finally { rmSync(home, { recursive: true, force: true }) }
})
