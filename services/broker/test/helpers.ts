import { randomBytes } from 'node:crypto'
import type { Store, Transaction, RecordRow } from '../src/store.js'
import type { ObjectStore, MediaObject } from '../src/objects.js'

export class MemoryStore implements Store {
  readonly records = new Map<string, RecordRow>()
  private tail: Promise<void> = Promise.resolve()
  async transaction<T>(_lock: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
    const prior = this.tail
    let release = () => {}
    this.tail = new Promise<void>(resolve => { release = resolve })
    await prior
    const snapshot = structuredClone(this.records)
    try {
      return await work({
        get: async key => structuredClone(this.records.get(key)),
        put: async row => { this.records.set(row.key, structuredClone(row)) },
        remove: async key => { this.records.delete(key) },
        owned: async owner => structuredClone([...this.records.values()].filter(row => row.owner === owner)),
        expired: async now => structuredClone([...this.records.values()].filter(row => row.expiresAt <= now)),
        count: async prefix => [...this.records.values()].filter(row => row.key.startsWith(prefix) && row.expiresAt > Date.now()).length
      })
    } catch (error) {
      this.records.clear()
      for (const [key, value] of snapshot) this.records.set(key, value)
      throw error
    } finally { release() }
  }
}
export class MemoryObjectStore implements ObjectStore {
  readonly objects = new Map<string, MediaObject>()
  readonly deleted: string[] = []
  failDelete = false
  constructor(private readonly origin = 'https://media.example.test') {}
  async stage(object: MediaObject, now: number) {
    this.objects.set(object.key, object)
    const query = new URLSearchParams({ expires: String(Math.floor(now / 1000) + 600), signature: randomBytes(16).toString('hex') })
    return { upload_url: `${this.origin}/${object.key}?${query}`, public_url: `${this.origin}/${object.key}?${query}&read=1` }
  }
  async remove(key: string) {
    if (this.failDelete) throw new Error('storage unavailable')
    this.objects.delete(key)
    this.deleted.push(key)
  }
}
