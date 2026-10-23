// Instagram API v26.0: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
import { InstagramError } from './instagram-http'
import { InstagramService, instagramSettings } from './instagram'
import type { InstagramSession, InstagramSettings } from '../shared/instagram'
import { DEMO_HANDLE } from '../shared/api'

type Handle = (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void

export function registerInstagramIpc(d: {
  handle: Handle
  service: InstagramService
  dev: boolean
  saveSettings: (settings: InstagramSettings) => Promise<unknown>
  /** Demo build: connected to DEMO_HANDLE, and the real API is never reached (posting goes through projects:demoPost). */
  demo?: boolean
}): void {
  if (d.demo) {
    const session: InstagramSession = { connected: true, accountId: 'demo', username: DEMO_HANDLE, expiresAt: Date.now() + 60 * 24 * 3600e3 }
    const off = () => {
      throw new InstagramError('IG_DEMO', 'This is the demo account. Use Post to Instagram in Share.')
    }
    d.handle('instagram:configure', off)
    d.handle('instagram:session', () => session)
    d.handle('instagram:connect', () => session)
    d.handle('instagram:cancelConnect', () => undefined)
    d.handle('instagram:disconnect', () => undefined)
    d.handle('instagram:publish', off)
    d.handle('instagram:insights', off)
    return
  }
  d.handle('instagram:configure', async (_event, value) => {
    if (!d.dev) throw new InstagramError('IG_DISABLED', 'Instagram is available only in developer mode.')
    const settings = instagramSettings(value)
    await d.service.disconnect()
    await d.saveSettings(settings)
  })
  d.handle('instagram:session', () => d.service.session())
  d.handle('instagram:connect', () => d.service.connect())
  d.handle('instagram:cancelConnect', () => d.service.cancelConnect())
  d.handle('instagram:disconnect', () => d.service.disconnect())
  d.handle('instagram:publish', (_event, value) => d.service.publish(value))
  d.handle('instagram:insights', (_event, slug, version, postId) => {
    if (typeof slug !== 'string' || typeof version !== 'number' || typeof postId !== 'string')
      throw new InstagramError('IG_INPUT', 'Choose a project version and Instagram post.')
    return d.service.insights(slug, version, postId)
  })
}
