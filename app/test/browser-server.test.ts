// The browser server (main/server) over real sockets: who gets in, who is refused, and how video bytes come out.
// A browser on this computer is the client; a web page from anywhere else, DNS rebinding, and another local process
// that learned something the browser sent are the attacks.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type WebSocket from 'ws'
import { createAuth, PAIRING_TTL_MS } from '../src/main/server/auth'
import { CLOSE_SIGNED_OUT, LIMITS, startBrowserServer, type BrowserServer } from '../src/main/server'
import { checkArgs } from '../src/shared/contract'
import { call, codeOf, http, newKeys, own, pairDevice, postPair, publicJwk, sign, signIn, type Signed } from './browser-client'
import { setupPaths } from './helpers'

const VIDEO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
let server: BrowserServer | null = null
const sockets: WebSocket[] = []

async function start(o: { rendererDir?: string } = {}): Promise<{ s: BrowserServer; root: string; home: string; calls: unknown[][] }> {
  const { root, home } = setupPaths()
  const dir = join(root, 'Projects', 'clip')
  mkdirSync(join(dir, 'versions', 'v1'), { recursive: true })
  writeFileSync(join(dir, 'versions', 'v1', 'export.mp4'), VIDEO)
  const calls: unknown[][] = []
  server = await startBrowserServer({
    log: () => undefined,
    rendererDir: o.rendererDir ?? null,
    // the real argument checks, a stand-in for the calls
    service: {
      dispatch: async (method, args) => {
        checkArgs(method, args)
        calls.push([method, args])
        return [{ slug: 'clip' }]
      }
    }
  })
  return { s: server, root, home, calls }
}

async function signedIn(s: BrowserServer): Promise<Signed> {
  const r = await signIn(s, await pairDevice(s))
  if (!('ws' in r)) throw new Error(`not signed in: ${JSON.stringify(r)}`)
  sockets.push(r.ws)
  return r
}

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate()
  await server?.close()
  server = null
})

const MEDIA = 'Projects/clip/versions/v1/export.mp4'

describe('browser server: a paired device key is required', () => {
  it('refuses the socket and media without a signed challenge and a media token, and serves them with both', async () => {
    const { s, calls } = await start()
    // a socket that never answers its challenge, or calls first, is closed as signed out
    expect(await signIn(s, null, { answer: async () => ({ id: 1, method: 'projects.list', args: [] }) })).toEqual({ closed: CLOSE_SIGNED_OUT })
    expect(await signIn(s, null, { answer: async () => ({ auth: { device: 'nobody', signature: 'x' } }) })).toEqual({ closed: CLOSE_SIGNED_OUT })
    expect((await http(s, `/media/guessed/${MEDIA}`)).status).toBe(401)
    expect((await http(s, `/media/${MEDIA}`)).status).toBe(401)
    expect(calls).toEqual([]) // nothing reached the service

    const { ws, mediaToken } = await signedIn(s)
    expect(mediaToken).toMatch(/^[\w-]{43}$/)
    expect(await call(ws, 'projects.list')).toEqual({ id: expect.any(Number), ok: true, value: [{ slug: 'clip' }] })
    expect((await http(s, `/media/${mediaToken}/${MEDIA}`)).status).toBe(200)
  })

  it('a signature from another key, or one replayed from another socket, does not sign in', async () => {
    const { s } = await start()
    const device = await pairDevice(s)
    const stranger = await newKeys()
    expect(await signIn(s, device, { answer: async (c) => ({ auth: { device: device.id, signature: await sign(stranger.privateKey, c) } }) })).toEqual({ closed: CLOSE_SIGNED_OUT })
    // what another local process could have seen: a whole signed answer from an earlier connection
    let seen: unknown
    const first = await signIn(s, device, {
      answer: async (c) => (seen = { auth: { device: device.id, signature: await sign(device.key, c) } })
    })
    if ('ws' in first) sockets.push(first.ws)
    expect(await signIn(s, device, { answer: async () => seen })).toEqual({ closed: CLOSE_SIGNED_OUT })
  })

  it('nothing that grants access is a cookie (cookies go to every port on 127.0.0.1)', async () => {
    const { s } = await start()
    const keys = await newKeys()
    const r = await postPair(s, { code: codeOf(s.pairingUrl()), key: await publicJwk(keys) })
    expect(r.status).toBe(200)
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(JSON.parse(String(r.body))).toEqual({ device: expect.stringMatching(/^[\w-]{22}$/) })
  })

  it('a pairing code works once and expires; only a P-256 public key can be registered', async () => {
    const { s } = await start()
    const key = await publicJwk(await newKeys())
    const code = codeOf(s.pairingUrl())
    for (const bad of [null, { kty: 'RSA', n: 'x', e: 'AQAB' }, { ...key, crv: 'P-384' }, { ...key, d: 'private' }, { ...key, x: 'not a point' }]) {
      expect((await postPair(s, { code, key: bad })).status, JSON.stringify(bad)).toBe(403)
    }
    expect((await postPair(s, { code, key })).status).toBe(200) // a bad key did not spend the code
    expect((await postPair(s, { code, key })).status).toBe(403)
    expect((await postPair(s, { code: 'x'.repeat(32), key })).status).toBe(403)

    let t = 0
    const auth = createAuth(1234, () => t)
    const old = auth.newPairingCode()
    t += PAIRING_TTL_MS
    expect(auth.pair(old, key)).toBeNull()
    expect(auth.pair(auth.newPairingCode(), key)).toMatch(/^[\w-]{22}$/)
  })
})

describe('browser server: wrong Host and Origin are refused (DNS rebinding, CSRF)', () => {
  it('any Host but 127.0.0.1:<port> is refused before anything else', async () => {
    const { s } = await start({ rendererDir: join(__dirname, 'fixtures') })
    const { mediaToken } = await signedIn(s)
    const device = await pairDevice(s)
    for (const host of ['evil.example', `evil.example:${s.port}`, `localhost:${s.port}`, `127.0.0.1:${s.port + 1}`, '127.0.0.1']) {
      expect((await http(s, `/media/${mediaToken}/${MEDIA}`, { headers: { Host: host } })).status, host).toBe(403)
      expect((await http(s, '/', { headers: { Host: host } })).status, host).toBe(403)
      const r = await http(s, '/api/pair', { method: 'POST', headers: { Host: host, Origin: own(s), 'Content-Type': 'application/json' }, body: '{}' })
      expect(r.status, host).toBe(403)
      expect(await signIn(s, device, { headers: { Host: host } }), host).toEqual({ refused: 403 })
    }
  })

  it('another origin, even another port on this computer, cannot open the socket, pair, or embed media', async () => {
    const { s } = await start()
    const { mediaToken } = await signedIn(s)
    const device = await pairDevice(s)
    for (const origin of ['http://evil.example', `http://localhost:${s.port}`, `http://127.0.0.1:${s.port + 1}`, 'null']) {
      expect(await signIn(s, device, { headers: { Origin: origin } }), origin).toEqual({ refused: 403 })
    }
    // a refused pairing does not spend the code
    const code = codeOf(s.pairingUrl())
    const key = await publicJwk(await newKeys())
    expect((await postPair(s, { code, key }, 'http://evil.example')).status).toBe(403)
    expect((await postPair(s, { code, key }, null)).status).toBe(403)
    expect((await postPair(s, { code, key })).status).toBe(200)
    // a page on another site or port loading our video, even with a leaked token
    for (const site of ['cross-site', 'same-site']) {
      expect((await http(s, `/media/${mediaToken}/${MEDIA}`, { headers: { 'Sec-Fetch-Site': site } })).status, site).toBe(403)
    }
    expect((await http(s, `/media/${mediaToken}/${MEDIA}`, { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status).toBe(200)
  })
})

describe('browser server: video byte ranges', () => {
  it('serves 206 ranges, open and suffix ranges, 416 past the end, HEAD without a body', async () => {
    const { s } = await start()
    const { mediaToken } = await signedIn(s)
    const url = `/media/${mediaToken}/${MEDIA}`
    const whole = await http(s, url)
    expect(whole.status).toBe(200)
    expect(whole.headers).toMatchObject({ 'content-type': 'video/mp4', 'content-length': '1000', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' })
    expect(whole.body.equals(VIDEO)).toBe(true)

    const mid = await http(s, url, { headers: { Range: 'bytes=100-199' } })
    expect(mid.status).toBe(206)
    expect(mid.headers).toMatchObject({ 'content-range': 'bytes 100-199/1000', 'content-length': '100' })
    expect(mid.body.equals(VIDEO.subarray(100, 200))).toBe(true)

    const open = await http(s, url, { headers: { Range: 'bytes=990-' } })
    expect(open.headers['content-range']).toBe('bytes 990-999/1000')
    expect(open.body.equals(VIDEO.subarray(990))).toBe(true)

    const tail = await http(s, url, { headers: { Range: 'bytes=-5' } })
    expect(tail.headers['content-range']).toBe('bytes 995-999/1000')
    expect(tail.body.equals(VIDEO.subarray(995))).toBe(true)

    const past = await http(s, url, { headers: { Range: 'bytes=1000-' } })
    expect(past.status).toBe(416)
    expect(past.headers['content-range']).toBe('bytes */1000')

    const head = await http(s, url, { method: 'HEAD', headers: { Range: 'bytes=0-9' } })
    expect(head.status).toBe(206)
    expect(head.headers['content-length']).toBe('10')
    expect(head.body.length).toBe(0)
  })

  it('serves only media refs inside the Reel Studio folder', async () => {
    const { s, root, home } = await start()
    const { mediaToken } = await signedIn(s)
    writeFileSync(join(home, 'secret.mp4'), 'secret')
    symlinkSync(join(home, 'secret.mp4'), join(root, 'Projects', 'clip', 'versions', 'v1', 'link.mp4'))
    expect((await http(s, `/media/${mediaToken}/Projects/clip/versions/v1/link.mp4`)).status).toBe(403)
    expect((await http(s, `/media/${mediaToken}/Projects/%2e%2e/%2e%2e/secret.mp4`)).status).toBe(400)
    expect((await http(s, `/media/${mediaToken}/Projects/clip/project.json`)).status).toBe(404)
  })
})

describe('browser server: limits on what a client sends', () => {
  it('pairing bodies over 1 KB, oversized or non-JSON socket messages, other versions and unknown calls are refused', async () => {
    const { s, calls } = await start()
    const big = await postPair(s, { code: 'x'.repeat(LIMITS.pairBody) })
    expect(big.status).toBe(413)
    expect((await http(s, `/media/x/${MEDIA}`, { method: 'POST' })).status).toBe(405)

    const device = await pairDevice(s)
    expect(await signIn(s, device, { protocol: null })).toEqual({ refused: 426 }) // no contract version offered
    expect(await signIn(s, device, { protocol: 'reel-contract.0' })).toEqual({ refused: 426 })

    const closed = (ws: WebSocket) => new Promise<number>((r) => ws.on('close', (code) => r(code)))
    const a = await signedIn(s)
    const aClosed = closed(a.ws)
    a.ws.send('x'.repeat(LIMITS.wsMessage + 1))
    expect(await aClosed).toBe(1009)
    const b = await signedIn(s)
    const bClosed = closed(b.ws)
    b.ws.send('not json')
    expect(await bClosed).toBe(1003)

    const c = await signedIn(s)
    expect(await call(c.ws, 'projects.remove', 'clip')).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(calls).toEqual([])
  })

  it('events reach every signed-in socket', async () => {
    const { s } = await start()
    const { ws } = await signedIn(s)
    const got = new Promise((r) => ws.once('message', (d) => r(JSON.parse(String(d)))))
    s.publish('job', { jobId: 'j', slug: 'clip', type: 'cancelled' })
    expect(await got).toEqual({ event: 'job', payload: { jobId: 'j', slug: 'clip', type: 'cancelled' } })
  })
})
