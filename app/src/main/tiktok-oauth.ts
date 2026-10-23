// TikTok Login Kit / OAuth v2: https://developers.tiktok.com/doc/login-kit-desktop/
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { TikTokError } from './tiktok-http'

export async function tiktokCallback(state: string, signal: AbortSignal) {
  let resolve!: (code: string) => void
  let reject!: (error: Error) => void
  let settled = false
  const result = new Promise<string>((ok, fail) => { resolve = ok; reject = fail })
  void result.catch(() => undefined)
  const finish = (value: string | Error) => {
    if (settled) return
    settled = true
    if (value instanceof Error) reject(value)
    else resolve(value)
  }
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    const addr = server.address()
    const host = addr && typeof addr === 'object' ? `127.0.0.1:${addr.port}` : ''
    if (req.method !== 'GET' || req.headers.host !== host || settled) { res.writeHead(404).end(); return }
    let url: URL
    try { url = new URL(req.url ?? '/', `http://${host}`) } catch { res.writeHead(400).end(); return }
    if (url.pathname !== '/tiktok/callback') { res.writeHead(404).end(); return }
    const got = Buffer.from(url.searchParams.get('state') ?? '')
    const want = Buffer.from(state)
    if (url.searchParams.getAll('state').length !== 1 || got.length !== want.length || !timingSafeEqual(got, want)) {
      res.writeHead(400).end('This sign-in link is not valid.')
      return
    }
    if (url.searchParams.has('error')) {
      res.writeHead(200).end('TikTok was not connected. Return to Reel Studio.')
      finish(new TikTokError('TT_DECLINED', 'TikTok was not connected. You can try again in Settings.'))
      return
    }
    const code = url.searchParams.get('code')
    if (url.searchParams.getAll('code').length !== 1 || !code || code.length > 2048 || /[\u0000-\u001f\u007f]/.test(code)) {
      res.writeHead(400).end('The sign-in response is incomplete.')
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('Return to Reel Studio to finish connecting TikTok.')
    finish(code)
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); ok() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new TikTokError('TT_CALLBACK', 'Could not open the TikTok callback. Try again.')
  const abort = () => finish(new TikTokError('TT_CANCELLED', 'TikTok connection was cancelled.'))
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  return {
    redirectUri: `http://127.0.0.1:${address.port}/tiktok/callback`,
    result,
    close: () => {
      signal.removeEventListener('abort', abort)
      server.close()
      server.closeAllConnections()
    }
  }
}
