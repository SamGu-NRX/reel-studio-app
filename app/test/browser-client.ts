// A browser, as far as the browser server can tell: HTTP and WebSocket requests from Node with the page's headers,
// and the page's sign-in (renderer/src/browser-reel.ts): an ECDSA P-256 key registered with a pairing code, and each
// socket's challenge signed with it.
import { request } from 'node:http'
import { webcrypto } from 'node:crypto'
import WebSocket from 'ws'
import { WS_PROTOCOL } from '../src/shared/contract'
import type { BrowserServer } from '../src/main/server'

export type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }

export const own = (s: BrowserServer): string => `http://127.0.0.1:${s.port}`
export const codeOf = (url: string): string => new URL(url).hash.replace('#pair=', '')

export function http(s: BrowserServer, path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Res> {
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

export interface TestDevice {
  id: string
  key: webcrypto.CryptoKey
}

export async function newKeys(): Promise<webcrypto.CryptoKeyPair> {
  return webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
}

export async function publicJwk(keys: webcrypto.CryptoKeyPair): Promise<object> {
  const j = await webcrypto.subtle.exportKey('jwk', keys.publicKey)
  return { kty: j.kty, crv: j.crv, x: j.x, y: j.y }
}

export function postPair(s: BrowserServer, body: unknown, origin: string | null = own(s)): Promise<Res> {
  return http(s, '/api/pair', {
    method: 'POST',
    headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

/** Pairs a new device with a fresh code, as the page does on /#pair=<code>. */
export async function pairDevice(s: BrowserServer): Promise<TestDevice> {
  const keys = await newKeys()
  const r = await postPair(s, { code: codeOf(s.pairingUrl()), key: await publicJwk(keys) })
  if (r.status !== 200) throw new Error(`pairing refused: ${r.status}`)
  return { id: JSON.parse(String(r.body)).device, key: keys.privateKey }
}

export async function sign(key: webcrypto.CryptoKey, challenge: string): Promise<string> {
  return Buffer.from(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(challenge))).toString('base64url')
}

export interface Signed {
  ws: WebSocket
  mediaToken: string
}

/**
 * Opens the socket and answers its challenge with `answer` (default: this device's real signature). Resolves with the
 * signed-in socket, the HTTP status that refused the upgrade, or the close code that ended it.
 */
export function signIn(
  s: BrowserServer,
  device: TestDevice | null,
  o: { headers?: Record<string, string>; protocol?: string | null; answer?: (challenge: string) => Promise<unknown> } = {}
): Promise<Signed | { refused: number } | { closed: number }> {
  return new Promise((resolve) => {
    const protocol = o.protocol === undefined ? WS_PROTOCOL : o.protocol
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, protocol ? [protocol] : [], {
      headers: { Host: `127.0.0.1:${s.port}`, Origin: own(s), ...o.headers }
    })
    ws.on('unexpected-response', (_req, res) => resolve({ refused: res.statusCode! }))
    ws.on('error', () => undefined)
    ws.on('close', (code) => resolve({ closed: code }))
    ws.on('message', async (data) => {
      const m = JSON.parse(String(data))
      if (m.challenge) {
        const answer = o.answer ? await o.answer(m.challenge) : { auth: { device: device!.id, signature: await sign(device!.key, m.challenge) } }
        if (answer !== undefined) ws.send(JSON.stringify(answer))
      } else if (m.signedIn) resolve({ ws, mediaToken: m.mediaToken })
    })
  })
}

export function call(ws: WebSocket, method: string, ...args: unknown[]): Promise<{ ok: boolean; value?: any; error?: { code: string } }> {
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
