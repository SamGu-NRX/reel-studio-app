// The browser server (main/server) over real sockets: who gets in, who is refused, and how video bytes come out.
// A browser on this computer is the client; a web page from anywhere else, and DNS rebinding, are the attacks.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import WebSocket from 'ws'
import { createAuth, PAIRING_TTL_MS } from '../src/main/server/auth'
import { LIMITS, startBrowserServer, WS_PROTOCOL, type BrowserServer } from '../src/main/server'
import { checkArgs } from '../src/shared/contract'
import { setupPaths } from './helpers'

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

function http(s: BrowserServer, path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: s.port, path, method: o.method ?? 'GET', headers: { Host: `127.0.0.1:${s.port}`, ...o.headers } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end(o.body)
  })
}

const own = (s: BrowserServer): string => `http://127.0.0.1:${s.port}`
const codeOf = (url: string): string => new URL(url).hash.replace('#code=', '')

async function pair(s: BrowserServer): Promise<string> {
  const r = await http(s, '/api/pair', {
    method: 'POST',
    headers: { Origin: own(s), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codeOf(s.pairingUrl()) })
  })
  expect(r.status).toBe(204)
  return String(r.headers['set-cookie']).split(';')[0]
}

/** Opens the WebSocket; resolves with the socket, or with the HTTP status that refused the upgrade. */
function socket(s: BrowserServer, headers: Record<string, string>, protocol: string | null = WS_PROTOCOL): Promise<WebSocket | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, protocol ? [protocol] : [], { headers: { Host: `127.0.0.1:${s.port}`, ...headers } })
    ws.on('open', () => resolve(ws))
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode!))
    ws.on('error', () => resolve(-1))
  })
}

function call(ws: WebSocket, method: string, args: unknown[] = []): Promise<{ ok: boolean; value?: any; error?: { code: string } }> {
  const id = Math.floor(Math.random() * 1e9)
  return new Promise((resolve) => {
    const on = (data: WebSocket.RawData) => {
      const m = JSON.parse(String(data))
      if (m.id !== id) return
      ws.off('message', on)
      resolve(m)
    }
    ws.on('message', on)
    ws.send(JSON.stringify({ id, method, args }))
  })
}

const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
let server: BrowserServer | null = null
const sockets: WebSocket[] = []

async function start(): Promise<{ s: BrowserServer; root: string; home: string; calls: unknown[][] }> {
  const { root, home } = setupPaths()
  const dir = join(root, 'Projects', 'clip')
  mkdirSync(join(dir, 'versions', 'v1'), { recursive: true })
  writeFileSync(join(dir, 'versions', 'v1', 'export.mp4'), VIDEO)
  const calls: unknown[][] = []
  server = await startBrowserServer({
    log: () => undefined,
    service: {
      // the real argument checks, a stand-in for the calls
      dispatch: async (method, args) => {
        checkArgs(method, args)
        calls.push([method, args])
        return [{ slug: 'clip' }]
      }
    }
  })
  return { s: server, root, home, calls }
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  await server?.close()
  server = null
})

const MEDIA = '/media/Projects/clip/versions/v1/export.mp4'

describe('browser server: the session token is required', () => {
  it('refuses media and the WebSocket without this launch\'s cookie, and serves them with it', async () => {
    const { s, calls } = await start()
    expect((await http(s, MEDIA)).status).toBe(401)
    expect((await http(s, MEDIA, { headers: { Cookie: `${s.auth.cookieName}=guessed` } })).status).toBe(401)
    expect(await socket(s, { Origin: own(s) })).toBe(401)
    expect(await socket(s, { Origin: own(s), Cookie: `${s.auth.cookieName}=guessed` })).toBe(401)
    expect(calls).toEqual([]) // nothing reached the service

    const cookie = await pair(s)
    expect(cookie.startsWith(`${s.auth.cookieName}=`)).toBe(true)
    expect((await http(s, MEDIA, { headers: { Cookie: cookie } })).status).toBe(200)
    const ws = await socket(s, { Origin: own(s), Cookie: cookie })
    expect(ws).toBeInstanceOf(WebSocket)
    sockets.push(ws as WebSocket)
    expect(await call(ws as WebSocket, 'projects.list')).toEqual({ id: expect.any(Number), ok: true, value: [{ slug: 'clip' }] })
  })

  it('a pairing code works once, the cookie is HttpOnly and SameSite=Strict, and codes expire', async () => {
    const { s } = await start()
    const code = codeOf(s.pairingUrl())
    const post = (c: unknown) => http(s, '/api/pair', { method: 'POST', headers: { Origin: own(s), 'Content-Type': 'application/json' }, body: JSON.stringify({ code: c }) })
    const first = await post(code)
    expect(first.status).toBe(204)
    expect(String(first.headers['set-cookie'])).toMatch(/; HttpOnly; SameSite=Strict; Path=\/$/)
    expect((await post(code)).status).toBe(403)
    expect((await post('x'.repeat(32))).status).toBe(403)
    expect((await post(null)).status).toBe(403)

    let t = 0
    const auth = createAuth(1234, () => t)
    const old = auth.newPairingCode()
    t += PAIRING_TTL_MS
    expect(auth.redeem(old)).toBeNull()
    expect(auth.redeem(auth.newPairingCode())).toMatch(/^reel_session_1234=/)
  })
})

describe('browser server: wrong Host and Origin are refused (DNS rebinding, CSRF)', () => {
  it('any Host but 127.0.0.1:<port> is refused before anything else, with or without the cookie', async () => {
    const { s } = await start()
    const cookie = await pair(s)
    for (const host of ['evil.example', `evil.example:${s.port}`, `localhost:${s.port}`, `127.0.0.1:${s.port + 1}`, '127.0.0.1']) {
      expect((await http(s, MEDIA, { headers: { Host: host, Cookie: cookie } })).status, host).toBe(403)
      expect((await http(s, '/pair', { headers: { Host: host } })).status, host).toBe(403)
      const r = await http(s, '/api/pair', { method: 'POST', headers: { Host: host, Origin: own(s), 'Content-Type': 'application/json' }, body: JSON.stringify({ code: codeOf(s.pairingUrl()) }) })
      expect(r.status, host).toBe(403)
      expect(await socket(s, { Host: host, Origin: own(s), Cookie: cookie }), host).toBe(403)
    }
  })

  it('another origin, even another port on this computer, cannot open the socket, pair, or embed media', async () => {
    const { s } = await start()
    const cookie = await pair(s)
    for (const origin of ['http://evil.example', `http://localhost:${s.port}`, `http://127.0.0.1:${s.port + 1}`, 'null']) {
      expect(await socket(s, { Origin: origin, Cookie: cookie }), origin).toBe(403)
    }
    expect(await socket(s, { Cookie: cookie }), 'no Origin').toBe(403)
    // a refused pairing does not spend the code
    const code = codeOf(s.pairingUrl())
    const post = (origin?: string) =>
      http(s, '/api/pair', { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    expect((await post('http://evil.example')).status).toBe(403)
    expect((await post()).status).toBe(403)
    expect((await post(own(s))).status).toBe(204)
    // a page on another site (or port) loading our video with the user's cookie
    for (const site of ['cross-site', 'same-site']) {
      expect((await http(s, MEDIA, { headers: { Cookie: cookie, 'Sec-Fetch-Site': site } })).status, site).toBe(403)
    }
    expect((await http(s, MEDIA, { headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200)
  })
})

describe('browser server: video byte ranges', () => {
  it('serves 206 ranges, open and suffix ranges, 416 past the end, HEAD without a body', async () => {
    const { s } = await start()
    const Cookie = await pair(s)
    const whole = await http(s, MEDIA, { headers: { Cookie } })
    expect(whole.status).toBe(200)
    expect(whole.headers).toMatchObject({ 'content-type': 'video/mp4', 'content-length': '1000', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' })
    expect(whole.body.equals(VIDEO)).toBe(true)

    const mid = await http(s, MEDIA, { headers: { Cookie, Range: 'bytes=100-199' } })
    expect(mid.status).toBe(206)
    expect(mid.headers).toMatchObject({ 'content-range': 'bytes 100-199/1000', 'content-length': '100' })
    expect(mid.body.equals(VIDEO.subarray(100, 200))).toBe(true)

    const open = await http(s, MEDIA, { headers: { Cookie, Range: 'bytes=990-' } })
    expect(open.headers['content-range']).toBe('bytes 990-999/1000')
    expect(open.body.equals(VIDEO.subarray(990))).toBe(true)

    const tail = await http(s, MEDIA, { headers: { Cookie, Range: 'bytes=-5' } })
    expect(tail.headers['content-range']).toBe('bytes 995-999/1000')
    expect(tail.body.equals(VIDEO.subarray(995))).toBe(true)

    const past = await http(s, MEDIA, { headers: { Cookie, Range: 'bytes=1000-' } })
    expect(past.status).toBe(416)
    expect(past.headers['content-range']).toBe('bytes */1000')

    const head = await http(s, MEDIA, { method: 'HEAD', headers: { Cookie, Range: 'bytes=0-9' } })
    expect(head.status).toBe(206)
    expect(head.headers['content-length']).toBe('10')
    expect(head.body.length).toBe(0)
  })

  it('serves only media refs inside the Reel Studio folder', async () => {
    const { s, root, home } = await start()
    const Cookie = await pair(s)
    writeFileSync(join(home, 'secret.mp4'), 'secret')
    symlinkSync(join(home, 'secret.mp4'), join(root, 'Projects', 'clip', 'versions', 'v1', 'link.mp4'))
    expect((await http(s, '/media/Projects/clip/versions/v1/link.mp4', { headers: { Cookie } })).status).toBe(403)
    expect((await http(s, '/media/Projects/%2e%2e/%2e%2e/secret.mp4', { headers: { Cookie } })).status).toBe(400)
    expect((await http(s, '/media/Projects/clip/project.json', { headers: { Cookie } })).status).toBe(404)
  })
})

describe('browser server: limits on what a client sends', () => {
  it('pairing bodies over 1 KB, oversized or non-JSON socket messages, and unknown calls are refused', async () => {
    const { s, calls } = await start()
    const big = await http(s, '/api/pair', { method: 'POST', headers: { Origin: own(s), 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'x'.repeat(LIMITS.pairBody) }) })
    expect(big.status).toBe(413)
    expect((await http(s, MEDIA, { method: 'POST' })).status).toBe(405)

    const Cookie = await pair(s)
    expect(await socket(s, { Origin: own(s), Cookie }, null)).toBe(426) // no contract version offered
    expect(await socket(s, { Origin: own(s), Cookie }, 'reel-contract.0')).toBe(426)

    const closed = (ws: WebSocket) => new Promise<number>((r) => ws.on('close', (code) => r(code)))
    const a = (await socket(s, { Origin: own(s), Cookie })) as WebSocket
    const aClosed = closed(a)
    a.send('x'.repeat(LIMITS.wsMessage + 1))
    expect(await aClosed).toBe(1009)
    const b = (await socket(s, { Origin: own(s), Cookie })) as WebSocket
    const bClosed = closed(b)
    b.send('not json')
    expect(await bClosed).toBe(1003)

    const c = (await socket(s, { Origin: own(s), Cookie })) as WebSocket
    sockets.push(c)
    expect(await call(c, 'projects.remove', ['clip'])).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(calls).toEqual([])
  })

  it('events reach every signed-in socket', async () => {
    const { s } = await start()
    const ws = (await socket(s, { Origin: own(s), Cookie: await pair(s) })) as WebSocket
    sockets.push(ws)
    const got = new Promise((r) => ws.once('message', (d) => r(JSON.parse(String(d)))))
    s.publish('job', { jobId: 'j', slug: 'clip', type: 'cancelled' })
    expect(await got).toEqual({ event: 'job', payload: { jobId: 'j', slug: 'clip', type: 'cancelled' } })
  })
})
