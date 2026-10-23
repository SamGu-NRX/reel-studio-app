// Instagram API v26.0: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
import { InstagramError } from './instagram-http'
import { InstagramService, instagramSettings } from './instagram'
import type { InstagramSettings } from '../shared/instagram'

type Handle = (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => void

export function registerInstagramIpc(d: {
  handle: Handle
  service: InstagramService
  dev: boolean
  saveSettings: (settings: InstagramSettings) => Promise<unknown>
}): void {
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
