import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import type { Store, Transaction, RecordRow } from './store.js'
import type { ObjectStore } from './objects.js'

export interface BrokerConfig {
  brokerOrigin: string
  instagramAppId: string
  instagramAppSecret: string
  tiktokClientKey: string
  tiktokClientSecret: string
  cronSecret: string
  privacyContactEmail: string
  privacyOperatorName: string
}
interface Options { config: BrokerConfig; store: Store; objects: ObjectStore; fetch: typeof fetch; now?: () => number }
const minute = 60_000
const day = 86_400_000
const opaque = z.string().min(1).max(8192)
const proof = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/)
const stateValue = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const platform = z.enum(['instagram', 'tiktok'])
const installSchema = z.object({ platform, account: z.string(), createdAt: z.number(), expiresAt: z.number() })
const refreshSchema = z.object({ installKey: z.string(), account: z.string() })
const startSchema = z.object({ app_id: z.string(), state: stateValue, loopback_uri: z.string(), code_challenge: stateValue, code_challenge_method: z.literal('S256') }).strict()
const transactionSchema = z.object({ loopback: z.string(), challenge: stateValue, createdAt: z.number(), phase: z.enum(['started', 'exchanging']) })
const handoffSchema = z.object({ loopback: z.string(), challenge: stateValue, createdAt: z.number(), phase: z.literal('handoff'), handoffDigest: z.string(), accessToken: opaque, tokenType: z.string(), permissions: z.array(z.string()), account: z.string(), tokenExpiresAt: z.number() })
const instagramToken = z.object({ access_token: opaque, token_type: z.string().default('bearer'), expires_in: z.number().int().positive() })
const shortToken = z.object({ access_token: opaque, user_id: z.union([z.string(), z.number()]), permissions: z.array(z.string()) })
const accountSchema = z.object({ user_id: z.union([z.string(), z.number()]), account_type: z.enum(['BUSINESS', 'MEDIA_CREATOR']) })
const tikTokToken = z.object({ access_token: opaque, refresh_token: opaque, open_id: opaque, token_type: z.string().default('Bearer'), scope: z.string(), expires_in: z.number().int().positive(), refresh_expires_in: z.number().int().positive() })
const mediaSchema = z.object({ objectKey: z.string(), installKey: z.string(), uploadExpiresAt: z.number(), deleted: z.boolean().default(false) })
const deletionReceipt = z.object({ confirmation_code: z.string(), status: z.enum(['pending', 'complete']) })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const random = () => randomBytes(32).toString('base64url')
const ownerKey = (p: z.infer<typeof platform>, account: string) => `${p}:${hash(account)}`
const secureEqual = (a: string, b: string) => {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }
class HttpError extends Error {
  constructor(readonly status: number, readonly code: number | string) { super('Broker request rejected') }
}
function fail(status: number, code: number | string = status): never { throw new HttpError(status, code) }
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: noStore }) }
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  return result.success ? result.data : fail(400)
}
function live(row: RecordRow | undefined, now: number): row is RecordRow { return row !== undefined && row.expiresAt > now }

// The allowlist is deliberately only these two literal loopback patterns. URL normalization must not expand it.
export function loopback(value: string, p: 'instagram' | 'tiktok'): string {
  const match = new RegExp(`^http://127\\.0\\.0\\.1:([1-9][0-9]{0,4})/${p}/callback$`).exec(value)
  if (!match?.[1] || Number(match[1]) > 65535) return fail(400)
  return value
}
async function boundedText(request: Request): Promise<string> {
  const reader = request.body?.getReader()
  if (!reader) return fail(400)
  let bytes = 0
  const parts: Uint8Array[] = []
  while (true) {
    const next = await reader.read()
    if (next.done) break
    bytes += next.value.byteLength
    if (bytes > 16_384) { await reader.cancel(); return fail(413) }
    parts.push(next.value)
  }
  return Buffer.concat(parts).toString('utf8')
}
async function readBody(request: Request, form = false): Promise<unknown> {
  const type = request.headers.get('content-type')?.split(';')[0]
  if (type !== 'application/json' && !(form && type === 'application/x-www-form-urlencoded')) return fail(415)
  const text = await boundedText(request)
  try { return type === 'application/json' ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text)) }
  catch { return fail(400) }
}

export function createBroker(options: Options): (request: Request) => Promise<Response> {
  const { config, store, objects } = options
  const now = options.now ?? Date.now
  const instagramCallback = `${config.brokerOrigin}/api/instagram/oauth/callback`
  async function upstream(p: 'instagram' | 'tiktok', url: string | URL, init?: RequestInit): Promise<unknown> {
    const response = await options.fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) })
    const body: unknown = await response.json().catch(() => null)
    const error = z.object({ error: z.union([z.string(), z.object({ code: z.union([z.string(), z.number()]) })]) }).safeParse(body)
    if (!response.ok || error.success) {
      const raw = error.success ? (typeof error.data.error === 'string' ? error.data.error : error.data.error.code) : undefined
      const safeCode = p === 'instagram' ? (typeof raw === 'number' ? raw : 190) :
        (typeof raw === 'string' && ['invalid_grant', 'invalid_client', 'invalid_request', 'invalid_scope', 'access_denied', 'rate_limit_exceeded', 'access_token_invalid'].includes(raw) ? raw : 'server_error')
      throw new HttpError(response.status === 429 ? 429 : response.status >= 500 ? 502 : 400, safeCode)
    }
    return body
  }
  async function rate(key: string, maximum: number, windowMs: number): Promise<void> {
    const allowed = await store.transaction(`rate:${key}`, async tx => {
      const id = `rate:${key}`
      const row = await tx.get(id)
      const count = live(row, now()) ? z.number().parse(row.value) : 0
      await tx.put({ key: id, owner: id, expiresAt: live(row, now()) ? row.expiresAt : now() + windowMs, value: count + 1 })
      return count < maximum
    })
    if (!allowed) fail(429)
  }
  async function install(request: Request, p?: 'instagram' | 'tiktok') {
    const token = request.headers.get('x-reel-install-token') ?? ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return fail(401)
    const key = `install:${hash(token)}`
    const row = await store.transaction(key, tx => tx.get(key))
    if (!live(row, now())) return fail(401)
    const value = installSchema.parse(row.value)
    if (p && value.platform !== p) return fail(403)
    await rate(key, 30, minute)
    return { key, row, value }
  }
  async function requireInstall(tx: Transaction, key: string) {
    const row = await tx.get(key)
    if (!live(row, now())) return fail(401)
    return installSchema.parse(row.value)
  }
  async function issue(tx: Transaction, p: 'instagram' | 'tiktok', account: string, expiresAt: number) {
    const token = random()
    const key = `install:${hash(token)}`
    const owner = ownerKey(p, account)
    await tx.put({ key, owner, expiresAt, value: { platform: p, account, createdAt: now(), expiresAt } })
    return { token, key }
  }
  async function rejectOldGrant(tx: Transaction, owner: string, createdAt: number) {
    const revoked = await tx.get(`revoked:${owner}`)
    if (live(revoked, now()) && z.number().parse(revoked.value) >= createdAt) fail(401)
  }
  function redirect(destination: string, values: Record<string, string>) {
    const u = new URL(destination)
    u.search = new URLSearchParams(values).toString()
    return new Response(null, { status: 307, headers: { ...noStore, location: u.toString() } })
  }
  async function instagramStart(request: Request) {
    const body = parse(startSchema, await readBody(request))
    if (body.app_id !== config.instagramAppId) return fail(403)
    const destination = loopback(body.loopback_uri, 'instagram')
    // There is no install credential before OAuth. Vercel supplies this address; clients cannot supply arbitrary forwarding headers.
    await rate(`start:${hash(request.headers.get('x-vercel-forwarded-for') ?? 'local')}`, 20, minute)
    await rate('starts-global', 200, minute)
    await store.transaction('oauth-start', async tx => {
      if (await tx.get(`state:${body.state}`)) fail(400)
      if (await tx.count('state:') >= 1000) fail(429)
      await tx.put({ key: `state:${body.state}`, owner: '', expiresAt: now() + 10 * minute,
        value: { loopback: destination, challenge: body.code_challenge, createdAt: now(), phase: 'started' } })
    })
    return json({})
  }
  async function instagramReturn(url: URL) {
    const state = parse(stateValue, url.searchParams.get('state'))
    const key = `state:${state}`
    const transaction = await store.transaction(key, async tx => {
      const row = await tx.get(key)
      if (!live(row, now())) return fail(401)
      const value = parse(transactionSchema, row.value)
      if (value.phase !== 'started') return fail(401)
      await tx.put({ ...row, value: { ...value, phase: 'exchanging' } })
      return value
    })
    try {
      if (url.searchParams.has('error')) {
        await store.transaction(key, tx => tx.remove(key))
        return redirect(transaction.loopback, { state, error: 'access_denied' })
      }
      const code = parse(opaque, url.searchParams.get('code'))
      const form = new URLSearchParams({ client_id: config.instagramAppId, client_secret: config.instagramAppSecret,
        grant_type: 'authorization_code', redirect_uri: instagramCallback, code })
      const shortRaw = await upstream('instagram', 'https://api.instagram.com/oauth/access_token', { method: 'POST', body: form })
      const wrapped = z.object({ data: z.array(shortToken).min(1) }).safeParse(shortRaw)
      const short = parse(shortToken, wrapped.success ? wrapped.data.data[0] : shortRaw)
      const exchange = new URL('https://graph.instagram.com/access_token')
      exchange.search = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: config.instagramAppSecret, access_token: short.access_token }).toString()
      const token = parse(instagramToken, await upstream('instagram', exchange))
      const profile = parse(accountSchema, await upstream('instagram', 'https://graph.instagram.com/v26.0/me?fields=user_id,account_type', { headers: { authorization: `Bearer ${token.access_token}` } }))
      const account = String(profile.user_id)
      const owner = ownerKey('instagram', account)
      const handoff = random()
      await store.transaction(owner, async tx => {
        await rejectOldGrant(tx, owner, transaction.createdAt)
        const row = await tx.get(key)
        if (!live(row, now())) return fail(401)
        await tx.put({ key, owner, expiresAt: now() + minute, value: {
          ...transaction, phase: 'handoff', handoffDigest: hash(handoff), accessToken: token.access_token,
          tokenType: token.token_type, permissions: short.permissions, account, tokenExpiresAt: now() + token.expires_in * 1000
        } })
      })
      return redirect(transaction.loopback, { state, handoff })
    } catch {
      await store.transaction(key, tx => tx.remove(key))
      return redirect(transaction.loopback, { state, error: 'server_error' })
    }
  }
  async function instagramComplete(request: Request) {
    const body = parse(z.object({ state: stateValue, handoff: z.string().regex(/^[A-Za-z0-9_-]{16,512}$/), code_verifier: proof }).strict(), await readBody(request))
    const key = `state:${body.state}`
    const row = await store.transaction(key, tx => tx.get(key))
    if (!live(row, now()) || !row.owner) return fail(401)
    return store.transaction(row.owner, async tx => {
      const current = await tx.get(key)
      if (!live(current, now())) return fail(401)
      const value = parse(handoffSchema, current.value)
      const challenge = createHash('sha256').update(body.code_verifier).digest('base64url')
      if (!secureEqual(hash(body.handoff), value.handoffDigest) || !secureEqual(challenge, value.challenge)) return fail(401)
      await rejectOldGrant(tx, row.owner, value.createdAt)
      const issued = await issue(tx, 'instagram', value.account, value.tokenExpiresAt)
      await tx.remove(key)
      return json({ access_token: value.accessToken, token_type: value.tokenType,
        expires_in: Math.max(0, Math.floor((value.tokenExpiresAt - now()) / 1000)), permissions: value.permissions, install_token: issued.token })
    })
  }
  async function instagramRefresh(request: Request) {
    const authenticated = await install(request, 'instagram')
    const body = parse(z.object({ access_token: opaque }).strict(), await readBody(request))
    return store.transaction(authenticated.row.owner, async tx => {
      const record = await requireInstall(tx, authenticated.key)
      const profile = parse(accountSchema, await upstream('instagram', 'https://graph.instagram.com/v26.0/me?fields=user_id,account_type', { headers: { authorization: `Bearer ${body.access_token}` } }))
      if (String(profile.user_id) !== record.account) return fail(403)
      const url = new URL('https://graph.instagram.com/refresh_access_token')
      url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: body.access_token }).toString()
      const token = parse(instagramToken, await upstream('instagram', url))
      const expiresAt = now() + token.expires_in * 1000
      await tx.put({ ...authenticated.row, expiresAt, value: { ...record, expiresAt } })
      return json(token)
    })
  }
  async function tikTok(request: Request) {
    const body = parse(z.discriminatedUnion('grant_type', [
      z.object({ client_key: z.string(), grant_type: z.literal('authorization_code'), code: opaque, redirect_uri: z.string(), code_verifier: proof }).strict(),
      z.object({ client_key: z.string(), grant_type: z.literal('refresh_token'), refresh_token: opaque }).strict()
    ]), await readBody(request))
    if (body.client_key !== config.tiktokClientKey) return fail(403, 'invalid_client')
    const form = new URLSearchParams({ client_key: config.tiktokClientKey, client_secret: config.tiktokClientSecret, grant_type: body.grant_type })
    if (body.grant_type === 'authorization_code') {
      form.set('code', body.code); form.set('redirect_uri', loopback(body.redirect_uri, 'tiktok')); form.set('code_verifier', body.code_verifier)
      await rate(`tt-start:${hash(request.headers.get('x-vercel-forwarded-for') ?? 'local')}`, 20, minute)
      await rate('tt-start-global', 200, minute)
      const createdAt = now()
      const claimKey = `code:${hash(body.code)}`
      await store.transaction('code-admission', async tx => {
        // A shared admission lock makes the live-reservation cap hold across distinct authorization codes.
        if (await tx.count('code:') >= 1000) fail(429)
        if (live(await tx.get(claimKey), now())) fail(401)
        await tx.put({ key: claimKey, owner: '', expiresAt: now() + 10 * minute, value: true })
      })
      let rawToken: unknown
      try {
        rawToken = await upstream('tiktok', 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', body: form })
      } catch (error) {
        if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
          await store.transaction(claimKey, tx => tx.remove(claimKey))
        }
        throw error
      }
      const token = parse(tikTokToken, rawToken)
      const owner = ownerKey('tiktok', token.open_id)
      return store.transaction(owner, async tx => {
        await rejectOldGrant(tx, owner, createdAt)
        const expiresAt = now() + token.refresh_expires_in * 1000
        const issued = await issue(tx, 'tiktok', token.open_id, expiresAt)
        await tx.put({ key: `refresh:${hash(token.refresh_token)}`, owner, expiresAt, value: { installKey: issued.key, account: token.open_id } })
        return json({ ...token, install_token: issued.token })
      })
    }
    const authenticated = await install(request, 'tiktok')
    const refreshKey = `refresh:${hash(body.refresh_token)}`
    const row = await store.transaction(refreshKey, tx => tx.get(refreshKey))
    if (!live(row, now())) return fail(401, 'invalid_grant')
    const saved = refreshSchema.parse(row.value)
    if (saved.installKey !== authenticated.key) return fail(401, 'invalid_grant')
    form.set('refresh_token', body.refresh_token)
    return store.transaction(row.owner, async tx => {
      const current = await tx.get(refreshKey)
      if (!live(current, now())) return fail(401, 'invalid_grant')
      const installation = await requireInstall(tx, saved.installKey)
      const token = parse(tikTokToken, await upstream('tiktok', 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', body: form }))
      if (token.open_id !== saved.account) return fail(403, 'invalid_grant')
      const expiresAt = now() + token.refresh_expires_in * 1000
      await tx.remove(refreshKey)
      await tx.put({ key: `refresh:${hash(token.refresh_token)}`, owner: row.owner, expiresAt, value: saved })
      await tx.put({ key: saved.installKey, owner: row.owner, expiresAt, value: { ...installation, expiresAt } })
      return json(token)
    })
  }
  async function uploads(request: Request) {
    const authenticated = await install(request, 'instagram')
    const body = parse(z.object({ video_size: z.number().int().min(1).max(300_000_000), cover_size: z.number().int().min(1).max(8_000_000).nullable().optional() }).strict(), await readBody(request))
    await rate(`uploads:${authenticated.key}`, 5, minute)
    await rate(`uploads:${authenticated.row.owner}`, 20, 60 * minute)
    return store.transaction(authenticated.row.owner, async tx => {
      await requireInstall(tx, authenticated.key)
      if ((await tx.owned(authenticated.row.owner)).filter(row => row.key.startsWith('media:')).length >= 40) return fail(429)
      async function stage(size: number, contentType: 'video/mp4' | 'image/jpeg') {
        const objectKey = `staging/${random()}`
        // Record the reservation before signing. No bytes pass through this function.
        await tx.put({ key: `media:${objectKey}`, owner: authenticated.row.owner, expiresAt: now() + 26 * 60 * minute,
          value: { objectKey, installKey: authenticated.key, uploadExpiresAt: now() + 10 * minute, deleted: false } })
        return objects.stage({ key: objectKey, size, contentType }, now())
      }
      const video = await stage(body.video_size, 'video/mp4')
      const cover = body.cover_size ? await stage(body.cover_size, 'image/jpeg') : undefined
      return json({ video, ...(cover ? { cover } : {}) })
    })
  }
  async function deleteAccount(p: 'instagram' | 'tiktok', account: string, receiptKey: string) {
    const owner = ownerKey(p, account)
    const confirmationCode = random()
    const claim = await store.transaction(owner, async tx => {
      const prior = await tx.get(receiptKey)
      if (live(prior, now())) return { kind: 'existing', result: deletionReceipt.parse(prior.value) } as const
      await tx.put({ key: `revoked:${owner}`, owner: '', expiresAt: now() + 10 * minute, value: now() })
      const current = await tx.owned(owner)
      // Revoke credentials and mark media before touching the network. A slow object store cannot roll back revocation.
      for (const row of current.filter(row => !row.key.startsWith('media:'))) await tx.remove(row.key)
      for (const row of current.filter(row => row.key.startsWith('media:'))) {
        const media = mediaSchema.parse(row.value)
        await tx.put({ ...row, expiresAt: now() + minute, value: { ...media, deleted: true } })
      }
      await tx.put({ key: receiptKey, owner: '', expiresAt: now() + day,
        value: { confirmation_code: confirmationCode, status: 'pending' } })
      await tx.put({ key: `status:${confirmationCode}`, owner: '', expiresAt: now() + day, value: { owner } })
      return { kind: 'claimed', rows: current.filter(row => row.key.startsWith('media:')).map(row => mediaSchema.parse(row.value).objectKey) } as const
    })
    if (claim.kind === 'existing') return claim.result
    // Cap foreground network work. The cron drains the remaining marked reservations.
    const batch = claim.rows.slice(0, 10)
    const results = await Promise.allSettled(batch.map(key => objects.remove(key)))
    return store.transaction(owner, async tx => {
      for (let i = 0; i < batch.length; i++) {
        if (results[i]?.status !== 'fulfilled') continue
        const row = await tx.get(`media:${batch[i]}`)
        if (!row) continue
        const media = mediaSchema.parse(row.value)
        // Keep a second deletion scheduled beyond the signed PUT's expiry, even after the first deletion succeeds.
        if (media.uploadExpiresAt > now()) await tx.put({ ...row, expiresAt: media.uploadExpiresAt + 1000 })
        else await tx.remove(row.key)
      }
      const pending = (await tx.owned(owner)).some(row => row.key.startsWith('media:'))
      const result = deletionReceipt.parse({ confirmation_code: confirmationCode, status: pending ? 'pending' : 'complete' })
      await tx.put({ key: receiptKey, owner: '', expiresAt: now() + day, value: result })
      await tx.put({ key: `status:${result.confirmation_code}`, owner: '', expiresAt: now() + day, value: { owner } })
      return result
    })
  }
  async function metaDeletion(request: Request, deletion: boolean) {
    const body = parse(z.object({ signed_request: z.string().max(16_000) }), await readBody(request, true))
    const [signature, encoded] = body.signed_request.split('.')
    if (!signature || !encoded || body.signed_request.split('.').length !== 2 || !secureEqual(createHmac('sha256', config.instagramAppSecret).update(encoded).digest('base64url'), signature)) return fail(401)
    let raw: unknown
    try { raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) } catch { return fail(400) }
    const payload = parse(z.object({ algorithm: z.literal('HMAC-SHA256'), user_id: opaque, issued_at: z.number().int() }), raw)
    if (Math.abs(now() / 1000 - payload.issued_at) > 86400) return fail(401)
    const result = await deleteAccount('instagram', payload.user_id, `receipt:${hash(encoded)}`)
    return deletion ? json({ url: `${config.brokerOrigin}/api/deletion-status?code=${result.confirmation_code}`, confirmation_code: result.confirmation_code }) : json({})
  }
  async function tikTokWebhook(request: Request) {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail(415)
    const bytes = await boundedText(request)
    const signature = request.headers.get('tiktok-signature') ?? ''
    const timestamp = /(?:^|,)t=(\d+)(?:,|$)/.exec(signature)?.[1]
    const signatures = [...signature.matchAll(/(?:^|,)s=([a-f0-9]{64})(?=,|$)/g)].map(match => match[1])
    if (!timestamp || Math.abs(now() / 1000 - Number(timestamp)) > 300) return fail(401)
    const expected = createHmac('sha256', config.tiktokClientSecret).update(`${timestamp}.${bytes}`).digest('hex')
    if (!signatures.some(value => value && secureEqual(expected, value))) return fail(401)
    let raw: unknown
    try { raw = JSON.parse(bytes) } catch { return fail(400) }
    const event = parse(z.object({ client_key: z.literal(config.tiktokClientKey), event: z.string(), user_openid: z.string().optional() }), raw)
    if (event.event === 'authorization.removed') await deleteAccount('tiktok', parse(opaque, event.user_openid), `receipt:${hash(bytes)}`)
    return json({})
  }
  async function cleanup(request: Request) {
    if (!secureEqual(request.headers.get('authorization') ?? '', `Bearer ${config.cronSecret}`)) return fail(401)
    const expired = await store.transaction('cleanup-scan', tx => tx.expired(now()))
    let removed = 0
    let failed = 0
    const started = Date.now()
    for (const row of expired) {
      if (Date.now() - started > 40_000) break
      await store.transaction(row.owner || row.key, async tx => {
        const current = await tx.get(row.key)
        if (!current || current.expiresAt > now()) return
        try {
          if (current.key.startsWith('media:')) {
            const media = mediaSchema.parse(current.value)
            await objects.remove(media.objectKey)
            if (media.deleted && media.uploadExpiresAt > now()) {
              await tx.put({ ...current, expiresAt: media.uploadExpiresAt + 1000 })
              return
            }
          }
          await tx.remove(current.key)
          removed++
        } catch {
          failed++
          await tx.put({ ...current, expiresAt: now() + minute })
        }
      })
    }
    return json({ removed, failed })
  }
  return async request => {
    try {
      const url = new URL(request.url)
      if (url.origin !== config.brokerOrigin) return fail(400)
      const path = url.pathname
      if (request.method === 'GET' && path === '/api/privacy') {
        return json({ operator: config.privacyOperatorName, contact: config.privacyContactEmail,
          policy: 'This broker exchanges OAuth codes for Instagram and TikTok credentials. It encrypts Instagram tokens for a sixty-second desktop handoff and removes expired records during scheduled cleanup. It stores hashes of revocable install credentials and TikTok refresh credentials, account identifiers and temporary media reservations. Platform tokens return to the desktop and are not upload credentials. Instagram exports and covers go to the configured private object store; Meta reads them through ten-minute signed links. Media is removed after twenty-six hours or on account deletion. You may delete your broker data with the install token at /api/install/data-deletion or by removing app authorization at the platform. Already-published posts remain at the platform. Contact the operator to request deletion without your install credential.' })
      }
      if (request.method === 'GET' && path === '/api/instagram/oauth/callback') return await instagramReturn(url)
      if (request.method === 'GET' && path === '/api/cleanup') return await cleanup(request)
      if (request.method === 'GET' && path === '/api/deletion-status') {
        const code = parse(stateValue, url.searchParams.get('code'))
        const receipt = await store.transaction(`status:${code}`, tx => tx.get(`status:${code}`))
        if (!live(receipt, now())) return fail(404)
        const { owner } = z.object({ owner: z.string() }).parse(receipt.value)
        return store.transaction(owner, async tx => json({ confirmation_code: code,
          status: (await tx.owned(owner)).some(row => row.key.startsWith('media:')) ? 'pending' : 'complete' }))
      }
      if (request.method !== 'POST') return fail(405)
      if (path === '/api/instagram/oauth/start') return await instagramStart(request)
      if (path === '/api/instagram/oauth/complete') return await instagramComplete(request)
      if (path === '/api/instagram/oauth/refresh') return await instagramRefresh(request)
      if (path === '/api/tiktok/oauth/token') return await tikTok(request)
      if (path === '/api/instagram/uploads') return await uploads(request)
      if (path === '/api/meta/deauthorize') return await metaDeletion(request, false)
      if (path === '/api/meta/data-deletion') return await metaDeletion(request, true)
      if (path === '/api/tiktok/webhook' || path === '/api/tiktok/deauthorize') return await tikTokWebhook(request)
      if (path === '/api/install/revoke' || path === '/api/install/data-deletion') {
        const authenticated = await install(request)
        if (path.endsWith('/data-deletion')) {
          const result = await deleteAccount(authenticated.value.platform, authenticated.value.account, `receipt:${random()}`)
          return json(result)
        }
        await store.transaction(authenticated.row.owner, async tx => {
          await requireInstall(tx, authenticated.key)
          const records = (await tx.owned(authenticated.row.owner)).filter(row => row.key === authenticated.key ||
            (row.key.startsWith('refresh:') && refreshSchema.parse(row.value).installKey === authenticated.key))
          for (const row of records) await tx.remove(row.key)
        })
        return json({})
      }
      return fail(404)
    } catch (error) {
      if (error instanceof HttpError) return json({ error: { code: error.code } }, error.status)
      return json({ error: { code: 'server_error' } }, 500)
    }
  }
}
