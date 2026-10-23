// Instagram API v26.0: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
// safeStorage (Electron 44): https://www.electronjs.org/docs/latest/api/safe-storage
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { renameWithRetry } from './store'
import { id, InstagramError, object, positive, text } from './instagram-http'
import type { InstagramOutcome, InstagramPost } from '../shared/instagram'

export interface InstagramSecretStore {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}

export interface InstagramCredentials {
  accessToken: string
  expiresAt: number
  issuedAt: number
  accountId: string
  username: string
  appId: string
  brokerUrl: string
  // Legacy credential files have no broker credential and must reconnect.
  installToken?: string
}

export interface PendingRevocation { installToken: string; appId: string; brokerUrl: string }

export type PublishReceipt =
  | { state: 'processing'; accountId: string; containerId: string; inputHash: string }
  | { state: 'publishing'; accountId: string; containerId: string; inputHash: string }
  | { state: 'published'; accountId: string; containerId: string; inputHash: string; post: InstagramPost }

export function localDataError(): never {
  throw new InstagramError('IG_LOCAL_DATA', 'The saved Instagram data could not be read. Restore the file before trying again.')
}

export async function readObject(file: string): Promise<Record<string, unknown> | null> {
  let raw: string
  try { raw = await fs.readFile(file, 'utf8') } catch (e) {
    if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return null
    return localDataError()
  }
  try { return object(JSON.parse(raw)) } catch { return localDataError() }
}

export async function atomicInstagramFile(file: string, contents: string | Buffer): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, contents, { mode: 0o600, flag: 'wx' })
    await renameWithRetry(temp, file)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

export class InstagramTokenStore {
  constructor(private readonly dir: string, private readonly secrets: InstagramSecretStore) {}
  private file(): string { return join(this.dir, 'instagram-credentials.bin') }
  private secure(): void {
    if (!this.secrets.isEncryptionAvailable() || this.secrets.getSelectedStorageBackend?.() === 'basic_text')
      throw new InstagramError('IG_SECURE_STORAGE', 'This computer cannot store the Instagram connection securely. Enable its system keychain and try again.')
  }
  private async read(): Promise<{ credentials?: InstagramCredentials; pendingRevocations: PendingRevocation[] } | null> {
    let bytes: Buffer
    try { bytes = await fs.readFile(this.file()) } catch (e) {
      if (e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT') return null
      return localDataError()
    }
    this.secure()
    try {
      const raw = object(JSON.parse(this.secrets.decryptString(bytes)))
      const pendingRevocations = raw.pendingRevocations === undefined ? [] : this.pending(raw.pendingRevocations)
      if (raw.accessToken === undefined && raw.pendingRevocations === undefined) return localDataError()
      const source = raw
      const credentials = source.accessToken === undefined ? undefined : {
        accessToken: text(source.accessToken), expiresAt: positive(source.expiresAt), issuedAt: positive(source.issuedAt),
        accountId: id(source.accountId), username: text(source.username), appId: id(source.appId), brokerUrl: text(source.brokerUrl),
        ...(source.installToken === undefined ? {} : { installToken: text(source.installToken) })
      }
      return { credentials, pendingRevocations }
    } catch { return localDataError() }
  }
  private pending(value: unknown): PendingRevocation[] {
    if (!Array.isArray(value)) return localDataError()
    return value.map((v) => { const p = object(v); return { installToken: text(p.installToken), appId: id(p.appId), brokerUrl: text(p.brokerUrl) } })
  }
  async load(): Promise<InstagramCredentials | null> { return (await this.read())?.credentials ?? null }
  async pendingRevocations(): Promise<PendingRevocation[]> { return (await this.read())?.pendingRevocations ?? [] }
  async save(c: InstagramCredentials, pendingRevocations?: PendingRevocation[]): Promise<void> {
    await this.write({ credentials: c, pendingRevocations: pendingRevocations ?? await this.pendingRevocations() })
  }
  async savePending(pendingRevocations: PendingRevocation[]): Promise<void> { await this.write({ credentials: (await this.read())?.credentials, pendingRevocations }) }
  private async write(data: { credentials?: InstagramCredentials; pendingRevocations: PendingRevocation[] }): Promise<void> {
    this.secure()
    // Keep the user-requested 20 most recent orphaned installs in the same encrypted, atomic write.
    const encrypted = this.secrets.encryptString(JSON.stringify({ ...data.credentials, pendingRevocations: data.pendingRevocations.slice(-20) }))
    await fs.mkdir(this.dir, { recursive: true }); await atomicInstagramFile(this.file(), encrypted)
  }
  async clear(): Promise<void> {
    const pendingRevocations = await this.pendingRevocations()
    if (pendingRevocations.length) await this.write({ pendingRevocations }); else await fs.rm(this.file(), { force: true })
  }
  assertSecure(): void { this.secure() }
}

function post(value: unknown): InstagramPost {
  const p = object(value)
  if (typeof p.version !== 'number' || !Number.isSafeInteger(p.version) || p.version < 1) return localDataError()
  const publishedAt = text(p.publishedAt)
  if (!Number.isFinite(Date.parse(publishedAt))) return localDataError()
  return { version: p.version, accountId: id(p.accountId), postId: id(p.postId), publishedAt }
}

export async function receipt(dir: string, version: number): Promise<PublishReceipt | null> {
  const saved = await readObject(join(dir, 'instagram-publish.json'))
  if (!saved) return null
  if (saved.schemaVersion !== 1) return localDataError()
  const versions = object(saved.versions)
  const value = versions[`v${version}`]
  if (value === undefined) return null
  const r = object(value)
  const inputHash = text(r.inputHash)
  if (!/^[a-f0-9]{64}$/.test(inputHash)) return localDataError()
  const base = { accountId: id(r.accountId), containerId: id(r.containerId), inputHash }
  if (r.state === 'processing' || r.state === 'publishing') return { ...base, state: r.state }
  if (r.state === 'published') {
    const p = post(r.post)
    if (p.version !== version || p.accountId !== base.accountId) return localDataError()
    return { ...base, state: r.state, post: p }
  }
  return localDataError()
}

export async function saveReceipt(dir: string, version: number, value: PublishReceipt): Promise<void> {
  const file = join(dir, 'instagram-publish.json')
  const saved = await readObject(file)
  if (saved && saved.schemaVersion !== 1) return localDataError()
  const versions = saved ? object(saved.versions) : {}
  await atomicInstagramFile(file, JSON.stringify({ schemaVersion: 1, versions: { ...versions, [`v${version}`]: value } }, null, 2) + '\n')
}

export async function saveOutcome(dir: string, value: InstagramOutcome): Promise<void> {
  const file = join(dir, 'outcomes.json')
  const saved = await readObject(file)
  if (saved && saved.schemaVersion !== 1) return localDataError()
  const versions = saved ? object(saved.versions) : {}
  const key = `v${value.version}`
  const posts = versions[key] === undefined ? {} : object(versions[key])
  await atomicInstagramFile(file, JSON.stringify({ ...saved, schemaVersion: 1, versions: { ...versions, [key]: { ...posts, [value.postId]: value } } }, null, 2) + '\n')
}
