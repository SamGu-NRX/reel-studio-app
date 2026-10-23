import { createHmac, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createBroker, type BrokerConfig } from '../src/broker.js'
import { MemoryObjectStore, MemoryStore } from './helpers.js'

vi.stubGlobal('fetch', () => { throw new Error('Tests must not access the network') })

const json = (value: unknown) => ({
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value)
})
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
const baseConfig: BrokerConfig = {
  brokerOrigin: 'https://broker.example.test', instagramAppId: 'ig-app', instagramAppSecret: 'ig-secret',
  tiktokClientKey: 'tt-key', tiktokClientSecret: 'tt-secret',
  cronSecret: 'c'.repeat(32), privacyContactEmail: 'privacy@example.test', privacyOperatorName: 'Reel Studio'
}
const verifier = 'a'.repeat(43)
const challenge = createHash('sha256').update(verifier).digest('base64url')
function fixtureFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('api.instagram.com/oauth/access_token')) return response({ access_token: 'ig-short', user_id: 'ig-user', permissions: ['instagram_business_basic'] })
    if (url.includes('graph.instagram.com/access_token')) return response({ access_token: 'ig-long', token_type: 'bearer', expires_in: 5184000 })
    if (url.includes('graph.instagram.com/v26.0/me')) return response({ user_id: 'ig-user', username: 'creator', account_type: 'BUSINESS' })
    if (url.includes('graph.instagram.com/refresh_access_token')) return response({ access_token: 'ig-refreshed', token_type: 'bearer', expires_in: 5184000 })
    if (url.includes('open.tiktokapis.com/v2/oauth/token')) {
      const body = String(init?.body)
      return body.includes('refresh_token') ? response({ access_token: 'tt-refreshed', refresh_token: 'tt-refresh-2', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'tt-user', scope: 'user.info.basic video.upload' }) : response({ access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'tt-user', scope: 'user.info.basic video.upload' })
    }
    throw new Error(`unexpected upstream ${url}`)
  }
}
function make() {
  const store = new MemoryStore()
  const objects = new MemoryObjectStore('https://media.example.test')
  const broker = createBroker({ config: baseConfig, store, objects, fetch: fixtureFetch() })
  return { broker, store, objects }
}
async function startAndComplete(broker: ReturnType<typeof createBroker>) {
  const start = await broker(new Request('https://broker.example.test/api/instagram/oauth/start', json({ app_id: 'ig-app', state: 's'.repeat(43), loopback_uri: 'http://127.0.0.1:43123/instagram/callback', code_challenge: challenge, code_challenge_method: 'S256' })))
  expect(start.status).toBe(200)
  const callback = await broker(new Request('https://broker.example.test/api/instagram/oauth/callback?code=opaque%2Bcode&state=' + 's'.repeat(43), { method: 'GET' }))
  expect(callback.status).toBe(307)
  const location = callback.headers.get('location')!
  const handoff = new URL(location).searchParams.get('handoff')!
  const complete = await broker(new Request('https://broker.example.test/api/instagram/oauth/complete', json({ handoff, state: 's'.repeat(43), code_verifier: verifier })))
  expect(complete.status).toBe(200)
  return z.object({ access_token: z.string(), install_token: z.string() }).parse(await complete.json())
}

describe('OAuth exchange and refresh', () => {
  it('exchanges and refreshes Instagram without using the platform token as broker auth', async () => {
    const { broker } = make()
    const credentials = await startAndComplete(broker)
    expect(credentials.access_token).toBe('ig-long')
    expect(credentials.install_token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const refresh = await broker(new Request('https://broker.example.test/api/instagram/oauth/refresh', { ...json({ access_token: 'ig-long' }), headers: { 'content-type': 'application/json', 'x-reel-install-token': credentials.install_token } }))
    expect(refresh.status).toBe(200)
    expect((await refresh.json()).access_token).toBe('ig-refreshed')
  })
  it('exchanges and refreshes TikTok', async () => {
    const { broker } = make()
    const exchange = await broker(new Request('https://broker.example.test/api/tiktok/oauth/token', json({ client_key: 'tt-key', grant_type: 'authorization_code', code: 'opaque+code', redirect_uri: 'http://127.0.0.1:43123/tiktok/callback', code_verifier: verifier })))
    expect(exchange.status).toBe(200)
    const token = z.object({ install_token: z.string(), refresh_token: z.string() }).parse(await exchange.json())
    const refresh = await broker(new Request('https://broker.example.test/api/tiktok/oauth/token', { ...json({ client_key: 'tt-key', grant_type: 'refresh_token', refresh_token: token.refresh_token }), headers: { 'content-type': 'application/json', 'x-reel-install-token': token.install_token } }))
    expect(refresh.status).toBe(200)
    expect((await refresh.json()).access_token).toBe('tt-refreshed')
  })
})

describe('redirects, upload authorization, signed URLs and limits', () => {
  it('rejects a loopback redirect outside the allowlist', async () => {
    const { broker } = make()
    const result = await broker(new Request('https://broker.example.test/api/instagram/oauth/start', json({ app_id: 'ig-app', state: 'x'.repeat(43), loopback_uri: 'http://localhost:43123/instagram/callback', code_challenge: challenge, code_challenge_method: 'S256' })))
    expect(result.status).toBe(400)
  })
  it('requires the issued install token and returns per-object short-lived PUT URLs', async () => {
    const { broker } = make()
    const credentials = await startAndComplete(broker)
    const rejected = await broker(new Request('https://broker.example.test/api/instagram/uploads', { ...json({ video_size: 100 }), headers: { 'content-type': 'application/json', authorization: 'Bearer ig-long' } }))
    expect(rejected.status).toBe(401)
    const upload = await broker(new Request('https://broker.example.test/api/instagram/uploads', { ...json({ video_size: 100, cover_size: 20 }), headers: { 'content-type': 'application/json', 'x-reel-install-token': credentials.install_token } }))
    expect(upload.status).toBe(200)
    const body = z.object({ video: z.object({ upload_url: z.string(), public_url: z.string() }), cover: z.object({ upload_url: z.string() }) }).parse(await upload.json())
    expect(body.video.public_url).toContain('https://media.example.test/')
    expect(new URL(body.video.upload_url).searchParams.get('expires')).toBeTruthy()
    expect(Number(new URL(body.video.upload_url).searchParams.get('expires')) - Date.now() / 1000).toBeLessThanOrEqual(600)
    expect(body.video.public_url).not.toBe(body.cover.upload_url)
  })
  it('rate limits starts by install or client identity', async () => {
    const store = new MemoryStore(); const objects = new MemoryObjectStore('https://media.example.test')
    const broker = createBroker({ config: baseConfig, store, objects, fetch: fixtureFetch() })
    const body = { app_id: 'ig-app', state: 'z'.repeat(43), loopback_uri: 'http://127.0.0.1:43123/instagram/callback', code_challenge: challenge, code_challenge_method: 'S256' }
    for (let i = 0; i < 20; i++) {
      const state = String.fromCharCode(65 + (i % 26)).repeat(43)
      expect((await broker(new Request('https://broker.example.test/api/instagram/oauth/start', json({ ...body, state })))).status).toBe(200)
    }
    expect((await broker(new Request('https://broker.example.test/api/instagram/oauth/start', json({ ...body, state: 'y'.repeat(43) })))).status).toBe(429)
  })
})

describe('deletion', () => {
  it('deletes token records and staged objects on Meta data deletion', async () => {
    const { broker, objects } = make()
    const credentials = await startAndComplete(broker)
    const upload = await broker(new Request('https://broker.example.test/api/instagram/uploads', { ...json({ video_size: 100 }), headers: { 'content-type': 'application/json', 'x-reel-install-token': credentials.install_token } }))
    expect(upload.status).toBe(200)
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'ig-user', issued_at: Math.floor(Date.now() / 1000) })).toString('base64url')
    const signature = createHmac('sha256', 'ig-secret').update(payload).digest('base64url')
    const deletion = await broker(new Request('https://broker.example.test/api/meta/data-deletion', { ...json({ signed_request: `${signature}.${payload}` }), headers: { 'content-type': 'application/json' } }))
    expect(deletion.status).toBe(200)
    expect(objects.deleted.length).toBe(1)
    const rejected = await broker(new Request('https://broker.example.test/api/instagram/uploads', { ...json({ video_size: 100 }), headers: { 'content-type': 'application/json', 'x-reel-install-token': credentials.install_token } }))
    expect(rejected.status).toBe(401)
  })
})

const installHeaders = (token: string) => ({ 'content-type': 'application/json', 'x-reel-install-token': token })
const startBody = (state = 's'.repeat(43)) => ({ app_id: 'ig-app', state, loopback_uri: 'http://127.0.0.1:43123/instagram/callback', code_challenge: challenge, code_challenge_method: 'S256' })
const req = (path: string, body: unknown, token?: string) => new Request(`https://broker.example.test${path}`, {
  ...json(body), headers: token ? installHeaders(token) : { 'content-type': 'application/json' }
})
function metaRequest(now: number, overrides: Record<string, unknown> = {}) {
  const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'ig-user', issued_at: Math.floor(now / 1000), ...overrides })).toString('base64url')
  const signature = createHmac('sha256', baseConfig.instagramAppSecret).update(payload).digest('base64url')
  return { signed_request: `${signature}.${payload}` }
}
const ttCode = { client_key: 'tt-key', grant_type: 'authorization_code', code: 'opaque+code', redirect_uri: 'http://127.0.0.1:43123/tiktok/callback', code_verifier: verifier }

describe('credential boundaries and lifecycle', () => {
  it('consumes a proof-bound handoff once under concurrent redemption', async () => {
    const { broker } = make()
    await broker(req('/api/instagram/oauth/start', startBody()))
    const callback = await broker(new Request('https://broker.example.test/api/instagram/oauth/callback?code=c&state=' + 's'.repeat(43)))
    const location = new URL(callback.headers.get('location')!)
    expect(location.searchParams.has('access_token')).toBe(false)
    expect(location.searchParams.has('code')).toBe(false)
    const body = { state: 's'.repeat(43), handoff: location.searchParams.get('handoff'), code_verifier: verifier }
    const wrong = await broker(req('/api/instagram/oauth/complete', { ...body, code_verifier: 'b'.repeat(43) }))
    expect(wrong.status).toBe(401)
    const results = await Promise.all([broker(req('/api/instagram/oauth/complete', body)), broker(req('/api/instagram/oauth/complete', body))])
    expect(results.map(result => result.status).sort()).toEqual([200, 401])
    expect(results.find(result => result.status === 200)?.headers.get('cache-control')).toBe('no-store')
  })
  it('expires a handoff after sixty seconds and never redirects unknown state', async () => {
    let time = Date.now()
    const broker = createBroker({ config: baseConfig, store: new MemoryStore(), objects: new MemoryObjectStore(), fetch: fixtureFetch(), now: () => time })
    await broker(req('/api/instagram/oauth/start', startBody()))
    const callback = await broker(new Request('https://broker.example.test/api/instagram/oauth/callback?code=c&state=' + 's'.repeat(43)))
    const handoff = new URL(callback.headers.get('location')!).searchParams.get('handoff')
    time += 60_001
    expect((await broker(req('/api/instagram/oauth/complete', { state: 's'.repeat(43), handoff, code_verifier: verifier }))).status).toBe(401)
    const unknown = await broker(new Request('https://broker.example.test/api/instagram/oauth/callback?code=c&state=' + 'u'.repeat(43)))
    expect(unknown.status).toBe(401)
    expect(unknown.headers.has('location')).toBe(false)
  })
  it('removes failed TikTok code reservations', async () => {
    const store = new MemoryStore()
    const broker = createBroker({ config: baseConfig, store, objects: new MemoryObjectStore(), fetch: async () => response({ error: 'invalid_grant' }, 400) })
    for (let i = 0; i < 10; i++) {
      const result = await broker(req('/api/tiktok/oauth/token', { ...ttCode, code: `failed-${i}` }))
      expect(result.status).toBe(400)
    }
    expect([...store.records.keys()].filter(key => key.startsWith('code:'))).toHaveLength(0)
  })
  it.each([200, 500])('keeps a reservation when TikTok returns an error body with HTTP %i', async status => {
    const store = new MemoryStore()
    const broker = createBroker({ config: baseConfig, store, objects: new MemoryObjectStore(), fetch: async () => response({ error: 'server_error' }, status) })
    expect((await broker(req('/api/tiktok/oauth/token', ttCode))).status).toBe(status === 500 ? 502 : 400)
    expect([...store.records.keys()].filter(key => key.startsWith('code:'))).toHaveLength(1)
  })
  it('keeps a reservation when the TikTok exchange times out', async () => {
    const store = new MemoryStore()
    const broker = createBroker({ config: baseConfig, store, objects: new MemoryObjectStore(), fetch: async () => { throw new DOMException('Timed out', 'TimeoutError') } })
    expect((await broker(req('/api/tiktok/oauth/token', ttCode))).status).toBe(500)
    expect([...store.records.keys()].filter(key => key.startsWith('code:'))).toHaveLength(1)
  })
  it('refuses a 1001st outstanding TikTok code reservation', async () => {
    const store = new MemoryStore()
    const now = Date.now()
    for (let i = 0; i < 1000; i++) store.records.set(`code:${i}`, { key: `code:${i}`, owner: '', expiresAt: now + 600_000, value: true })
    let calls = 0
    const broker = createBroker({ config: baseConfig, store, objects: new MemoryObjectStore(), fetch: async () => { calls++; return response({ access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'tt-user', scope: 'user.info.basic,video.upload' }) } })
    expect((await broker(req('/api/tiktok/oauth/token', { ...ttCode, code: 'one-too-many' }))).status).toBe(429)
    expect(calls).toBe(0)
  })
  it('passes TikTok PKCE and opaque codes exactly once with the server secret', async () => {
    const calls: URLSearchParams[] = []
    const broker = createBroker({ config: baseConfig, store: new MemoryStore(), objects: new MemoryObjectStore(), fetch: async (_input, init) => {
      calls.push(new URLSearchParams(String(init?.body)))
      return response({ access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'tt-user', scope: 'user.info.basic,video.upload' })
    } })
    const result = await broker(req('/api/tiktok/oauth/token', { ...ttCode, code: 'a+b/%2F?=&' }))
    expect(result.status).toBe(200)
    expect(calls[0]?.get('code')).toBe('a+b/%2F?=&')
    expect(calls[0]?.get('code_verifier')).toBe(verifier)
    expect(calls[0]?.get('client_secret')).toBe(baseConfig.tiktokClientSecret)
    expect((await broker(req('/api/tiktok/oauth/token', { ...ttCode, code: 'a+b/%2F?=&' }))).status).toBe(401)
    expect(calls).toHaveLength(1)
  })
  it('requires independent install proof for both platform refresh routes', async () => {
    const { broker } = make()
    await startAndComplete(broker)
    await broker(req('/api/tiktok/oauth/token', ttCode))
    expect((await broker(req('/api/instagram/oauth/refresh', { access_token: 'ig-long' }))).status).toBe(401)
    expect((await broker(req('/api/tiktok/oauth/token', { client_key: 'tt-key', grant_type: 'refresh_token', refresh_token: 'tt-refresh' }))).status).toBe(401)
  })
  it('revokes an install credential independently of the platform token', async () => {
    const { broker } = make()
    const credentials = await startAndComplete(broker)
    expect((await broker(req('/api/install/revoke', {}, credentials.install_token))).status).toBe(200)
    expect((await broker(req('/api/instagram/uploads', { video_size: 100 }, credentials.install_token))).status).toBe(401)
  })
  it('limits uploads by install without blocking a separate OAuth install', async () => {
    const store = new MemoryStore()
    const broker = createBroker({ config: baseConfig, store, objects: new MemoryObjectStore(), fetch: fixtureFetch() })
    const first = await startAndComplete(broker)
    for (let i = 0; i < 5; i++) expect((await broker(req('/api/instagram/uploads', { video_size: 100 }, first.install_token))).status).toBe(200)
    expect((await broker(req('/api/instagram/uploads', { video_size: 100 }, first.install_token))).status).toBe(429)
    const second = await startAndComplete(broker)
    expect((await broker(req('/api/instagram/uploads', { video_size: 100 }, second.install_token))).status).toBe(200)
  })
  it('rejects both platform redirect bypasses before any exchange', async () => {
    let calls = 0
    const broker = createBroker({ config: baseConfig, store: new MemoryStore(), objects: new MemoryObjectStore(), fetch: async () => { calls++; throw new Error('must not exchange') } })
    for (const uri of ['http://localhost:1234/instagram/callback', 'http://127.1:1234/instagram/callback', 'http://2130706433:1234/instagram/callback', 'http://127.0.0.1:65536/instagram/callback', 'http://user@127.0.0.1:1234/instagram/callback', 'http://127.0.0.1:1234/instagram/callback?next=https://evil.test', 'http://127.0.0.1:1234/instagram/callback#fragment']) {
      expect((await broker(req('/api/instagram/oauth/start', { ...startBody(), loopback_uri: uri }))).status).toBe(400)
      expect((await broker(req('/api/tiktok/oauth/token', { ...ttCode, redirect_uri: uri.replace('instagram', 'tiktok') }))).status).toBe(400)
    }
    expect(calls).toBe(0)
  })
  it('rejects oversized media reservations and emits no storage grants', async () => {
    const { broker, objects } = make()
    const credentials = await startAndComplete(broker)
    expect((await broker(req('/api/instagram/uploads', { video_size: 300_000_001 }, credentials.install_token))).status).toBe(400)
    expect((await broker(req('/api/instagram/uploads', { video_size: 100, cover_size: 8_000_001 }, credentials.install_token))).status).toBe(400)
    expect(objects.objects.size).toBe(0)
  })
})

describe('authenticated deletion and cleanup', () => {
  it('rejects forged and stale Meta deletion requests', async () => {
    const { broker } = make()
    expect((await broker(req('/api/meta/data-deletion', { signed_request: 'forged.payload' }))).status).toBe(401)
    expect((await broker(req('/api/meta/data-deletion', { signed_request: `${'é'.repeat(43)}.payload` }))).status).toBe(401)
    expect((await broker(req('/api/meta/data-deletion', metaRequest(Date.now() - 2 * 86400_000)))).status).toBe(401)
  })
  it('authenticates TikTok deauthorization over the exact body and revokes refresh records', async () => {
    const { broker, store } = make()
    const exchange = await broker(req('/api/tiktok/oauth/token', ttCode))
    const token = z.object({ install_token: z.string() }).parse(await exchange.json())
    const body = JSON.stringify({ client_key: 'tt-key', event: 'authorization.removed', user_openid: 'tt-user', content: '{"reason":1}' })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', baseConfig.tiktokClientSecret).update(`${timestamp}.${body}`).digest('hex')
    const forged = await broker(new Request('https://broker.example.test/api/tiktok/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'tiktok-signature': `t=${timestamp},s=${'0'.repeat(64)}` } }))
    expect(forged.status).toBe(401)
    const result = await broker(new Request('https://broker.example.test/api/tiktok/webhook', { method: 'POST', body, headers: { 'content-type': 'application/json', 'tiktok-signature': `t=${timestamp},s=${signature}` } }))
    expect(result.status).toBe(200)
    expect([...store.records.keys()].filter(key => key.startsWith('install:') || key.startsWith('refresh:'))).toEqual([])
    expect((await broker(req('/api/tiktok/oauth/token', { client_key: 'tt-key', grant_type: 'refresh_token', refresh_token: 'tt-refresh' }, token.install_token))).status).toBe(401)
  })
  it('cleans expired media when OAuth records fill the disposable backlog', async () => {
    let time = Date.now()
    const store = new MemoryStore(); const objects = new MemoryObjectStore()
    const broker = createBroker({ config: baseConfig, store, objects, fetch: fixtureFetch(), now: () => time })
    const credentials = await startAndComplete(broker)
    await broker(req('/api/instagram/uploads', { video_size: 100 }, credentials.install_token))
    const object = [...objects.objects.values()][0]!
    for (let i = 0; i < 600; i++) store.records.set(`code:expired-${i}`, { key: `code:expired-${i}`, owner: '', expiresAt: time - 1, value: true })
    time += 26 * 60 * 60_000 + 1000
    await broker(new Request('https://broker.example.test/api/cleanup', { headers: { authorization: `Bearer ${baseConfig.cronSecret}` } }))
    expect(objects.deleted).toContain(object.key)
  })
  it('deduplicates a suffixed replay of a used Meta callback', async () => {
    const { broker, objects } = make()
    const credentials = await startAndComplete(broker)
    await broker(req('/api/instagram/uploads', { video_size: 100 }, credentials.install_token))
    const signed = metaRequest(Date.now())
    const first = await broker(req('/api/meta/data-deletion', signed))
    expect(first.status).toBe(200)
    const replay = await broker(req('/api/meta/data-deletion', { signed_request: `${signed.signed_request}..suffix` }))
    expect(replay.status).toBe(401)
    expect(objects.deleted).toHaveLength(1)
  })
  it('keeps replay cleanup until PUT expiry and returns one receipt for concurrent deletion', async () => {
    let time = Date.now()
    const store = new MemoryStore(); const objects = new MemoryObjectStore()
    const broker = createBroker({ config: baseConfig, store, objects, fetch: fixtureFetch(), now: () => time })
    const credentials = await startAndComplete(broker)
    await broker(req('/api/instagram/uploads', { video_size: 100 }, credentials.install_token))
    const object = [...objects.objects.values()][0]!
    const signed = metaRequest(time)
    const results = await Promise.all([broker(req('/api/meta/data-deletion', signed)), broker(req('/api/meta/data-deletion', signed))])
    const first = z.object({ url: z.string(), confirmation_code: z.string() }).parse(await results[0]!.json())
    const second = z.object({ confirmation_code: z.string() }).parse(await results[1]!.json())
    expect(first.confirmation_code).toBe(second.confirmation_code)
    expect(objects.objects.size).toBe(0)
    expect((await (await broker(new Request(first.url))).json()).status).toBe('pending')
    // Simulate an outstanding signed PUT recreating its one object after the first DeleteObject.
    objects.objects.set(object.key, object)
    time += 10 * 60_000 + 1001
    expect((await broker(new Request('https://broker.example.test/api/cleanup', { headers: { authorization: `Bearer ${baseConfig.cronSecret}` } }))).status).toBe(200)
    expect(objects.objects.size).toBe(0)
    expect((await (await broker(new Request(first.url))).json()).status).toBe('complete')
    expect([...store.records.keys()].some(key => key.startsWith('install:') || key.startsWith('state:'))).toBe(false)
  })
  it('revokes credentials even if storage deletion fails and retries the media later', async () => {
    let time = Date.now()
    const store = new MemoryStore(); const objects = new MemoryObjectStore()
    const broker = createBroker({ config: baseConfig, store, objects, fetch: fixtureFetch(), now: () => time })
    const credentials = await startAndComplete(broker)
    await broker(req('/api/instagram/uploads', { video_size: 100 }, credentials.install_token))
    objects.failDelete = true
    expect((await broker(req('/api/install/data-deletion', {}, credentials.install_token))).status).toBe(200)
    expect((await broker(req('/api/instagram/uploads', { video_size: 100 }, credentials.install_token))).status).toBe(401)
    expect(objects.objects.size).toBe(1)
    objects.failDelete = false
    time += 11 * 60_000
    await broker(new Request('https://broker.example.test/api/cleanup', { headers: { authorization: `Bearer ${baseConfig.cronSecret}` } }))
    expect(objects.objects.size).toBe(0)
  })
  it('rejects oversized bodies and protects cleanup with its own secret', async () => {
    const { broker } = make()
    expect((await broker(new Request('https://broker.example.test/api/cleanup'))).status).toBe(401)
    expect((await broker(req('/api/instagram/oauth/start', { padding: 'x'.repeat(17_000) }))).status).toBe(413)
    const privacy = await broker(new Request('https://broker.example.test/api/privacy'))
    expect(privacy.status).toBe(200)
    expect((await privacy.json()).contact).toBe(baseConfig.privacyContactEmail)
  })
})
