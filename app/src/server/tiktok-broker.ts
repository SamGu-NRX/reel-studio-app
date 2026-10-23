// TikTok OAuth v2: https://developers.tiktok.com/doc/oauth-user-access-token-management/
// Desktop PKCE v2: https://developers.tiktok.com/doc/login-kit-desktop/
// Server-only module. Electron does not import this handler or receive the client secret.
import { request, text, object, TikTokError, type TikTokFetch, TIKTOK_API } from '../main/tiktok-http'

export function createTikTokBroker(config: { clientKey: string; clientSecret: string; fetch: TikTokFetch }) {
  return async (incoming: Request): Promise<Response> => {
    const headers = { 'cache-control': 'no-store', 'content-type': 'application/json' }
    try {
      if (incoming.method !== 'POST' || new URL(incoming.url).pathname !== '/api/tiktok/oauth/token')
        return new Response('{}', { status: 404, headers })
      if (!incoming.headers.get('content-type')?.startsWith('application/json'))
        return new Response('{}', { status: 415, headers })
      // Deploy behind TLS with a body limit and per-client rate limiting.
      const raw = await incoming.text()
      if (raw.length > 16_384) return new Response('{}', { status: 413, headers })
      const body = object(JSON.parse(raw))
      if (body.client_key !== config.clientKey) throw new TikTokError('TT_SETUP', 'Unknown TikTok app.')
      const form = new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret })
      if (body.grant_type === 'authorization_code') {
        const redirect = new URL(text(body.redirect_uri))
        if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port ||
            redirect.pathname !== '/tiktok/callback' || redirect.search || redirect.hash || redirect.username || redirect.password)
          throw new TikTokError('TT_INPUT', 'The TikTok callback address is invalid.')
        const verifier = text(body.code_verifier)
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new TikTokError('TT_INPUT', 'The TikTok proof key is invalid.')
        form.set('grant_type', 'authorization_code'); form.set('code', text(body.code))
        form.set('redirect_uri', redirect.toString()); form.set('code_verifier', verifier)
      } else if (body.grant_type === 'refresh_token') {
        form.set('grant_type', 'refresh_token'); form.set('refresh_token', text(body.refresh_token))
      } else throw new TikTokError('TT_INPUT', 'The TikTok grant type is invalid.')
      const result = await request(config.fetch, `${TIKTOK_API}/oauth/token/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }, incoming.signal, false)
      return new Response(JSON.stringify(result), { status: 200, headers })
    } catch (e) {
      const error = e instanceof TikTokError ? e : new TikTokError('TT_INPUT', 'The TikTok authorization request is invalid.')
      return new Response(JSON.stringify({ error: { code: error.code, userMessage: error.userMessage } }), { status: 400, headers })
    }
  }
}
