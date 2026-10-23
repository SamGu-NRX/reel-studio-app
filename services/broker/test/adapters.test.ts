import { randomBytes } from 'node:crypto'
import { expect, it } from 'vitest'
import { S3ObjectStore } from '../src/objects.js'
import { Sealer } from '../src/store.js'

it('signs only one S3 object, exact PUT headers and a ten-minute GET lifetime without network', async () => {
  const store = new S3ObjectStore({ S3_ENDPOINT: 'https://objects.example.test', S3_REGION: 'us-east-1', S3_BUCKET: 'private-media', S3_ACCESS_KEY_ID: 'TEST-ONLY-ID', S3_SECRET_ACCESS_KEY: 'TEST-ONLY-SECRET', S3_FORCE_PATH_STYLE: 'true' })
  const now = Date.UTC(2026, 9, 23, 12, 0)
  const first = await store.stage({ key: 'staging/random-object-1', contentType: 'video/mp4', size: 123456 }, now)
  const second = await store.stage({ key: 'staging/random-object-2', contentType: 'image/jpeg', size: 1234 }, now)
  const put = new URL(first.upload_url)
  const get = new URL(first.public_url)
  expect(put.pathname).toBe('/private-media/staging/random-object-1')
  expect(put.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length', 'host']))
  expect(put.searchParams.get('X-Amz-Expires')).toBe('600')
  expect(get.searchParams.get('X-Amz-Expires')).toBe('600')
  expect(get.searchParams.get('response-cache-control')).toBe('no-store')
  expect(new URL(second.upload_url).pathname).not.toBe(put.pathname)
  expect(new URL(second.upload_url).searchParams.get('X-Amz-Signature')).not.toBe(put.searchParams.get('X-Amz-Signature'))
})
it('encrypts transient platform tokens and rejects ciphertext or record-key tampering', () => {
  const sealer = new Sealer(randomBytes(32))
  const payload = { access_token: 'synthetic-platform-token' }
  const ciphertext = sealer.seal(payload, 'state:one')
  expect(ciphertext).not.toContain(payload.access_token)
  expect(sealer.open(ciphertext, 'state:one')).toEqual(payload)
  expect(() => sealer.open(ciphertext, 'state:two')).toThrow()
  const corrupt = Buffer.from(ciphertext, 'base64url')
  corrupt[28] = (corrupt[28] ?? 0) ^ 1
  expect(() => sealer.open(corrupt.toString('base64url'), 'state:one')).toThrow()
})
