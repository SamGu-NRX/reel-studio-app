import { expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, unlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { protocol } from 'electron'
import { handleMediaProtocol } from '../src/main/media'
import { allowLinkedMedia } from '../src/main/media-allow'
import { mediaUrl } from '../src/main/media-url'
import { setupPaths } from './helpers'
vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }))
it('retains PR17 real-path containment and Library-link grants in the merged protocol', async () => {
 const { home, root } = setupPaths()
 mkdirSync(root, { recursive: true })
 const outside = join(home, 'outside.mp4'), link = join(root, 'linked.mp4')
 writeFileSync(outside, 'library video')
 symlinkSync(outside, link)
 handleMediaProtocol(() => [root])
 const handler = vi.mocked(protocol.handle).mock.calls.at(-1)![1]
 expect((await handler(new Request(mediaUrl(link)))).status).toBe(403)
 allowLinkedMedia(link, realpathSync(outside))
 const allowed = await handler(new Request(mediaUrl(outside)))
 expect(allowed.status).toBe(200)
 expect(await allowed.text()).toBe('library video')
 unlinkSync(link)
 expect((await handler(new Request(mediaUrl(outside)))).status).toBe(403)
})
