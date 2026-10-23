import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import postgres from 'postgres'
import { z } from 'zod'

export interface RecordRow {
  key: string
  owner: string
  expiresAt: number
  value: unknown
}
export interface Transaction {
  get(key: string): Promise<RecordRow | undefined>
  put(row: RecordRow): Promise<void>
  remove(key: string): Promise<void>
  owned(owner: string): Promise<RecordRow[]>
  expired(now: number): Promise<RecordRow[]>
  count(prefix: string): Promise<number>
}
export interface Store {
  transaction<T>(lock: string, work: (tx: Transaction) => Promise<T>): Promise<T>
}

export class Sealer {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('BROKER_ENCRYPTION_KEY must decode to 32 bytes')
  }
  seal(value: unknown, context: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(context))
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
  }
  open(value: string, context: string): unknown {
    const bytes = Buffer.from(value, 'base64url')
    const cipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12))
    cipher.setAAD(Buffer.from(context))
    cipher.setAuthTag(bytes.subarray(12, 28))
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString())
  }
}

const dbRow = z.object({ key: z.string(), owner: z.string(), expires_at: z.coerce.number(), payload: z.string() })
export function postgresStore(databaseUrl: string, sealer: Sealer): Store {
  const sql = postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 5, ssl: 'require' })
  const decode = (raw: unknown): RecordRow => {
    const row = dbRow.parse(raw)
    return { key: row.key, owner: row.owner, expiresAt: row.expires_at, value: sealer.open(row.payload, row.key) }
  }
  return {
    async transaction<T>(lock: string, work: (tx: Transaction) => Promise<T>): Promise<T> {
      // Wrap the result so Postgres.js's array unwrapping cannot change the callback's type.
      const result = await sql.begin(async tx => {
        await tx`SET LOCAL statement_timeout = '25s'`
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`
        const operations: Transaction = {
          async get(key) {
            const rows = await tx`SELECT * FROM broker_records WHERE key = ${key}`
            return rows[0] ? decode(rows[0]) : undefined
          },
          async put(row) {
            await tx`INSERT INTO broker_records (key, owner, expires_at, payload)
              VALUES (${row.key}, ${row.owner}, ${row.expiresAt}, ${sealer.seal(row.value, row.key)})
              ON CONFLICT (key) DO UPDATE SET owner = EXCLUDED.owner, expires_at = EXCLUDED.expires_at, payload = EXCLUDED.payload`
          },
          async remove(key) { await tx`DELETE FROM broker_records WHERE key = ${key}` },
          async owned(owner) { return (await tx`SELECT * FROM broker_records WHERE owner = ${owner}`).map(decode) },
          async expired(now) { return (await tx`SELECT * FROM broker_records WHERE expires_at <= ${now} ORDER BY expires_at LIMIT 500`).map(decode) },
          async count(prefix) {
            const rows = await tx`SELECT count(*) AS count FROM broker_records WHERE starts_with(key, ${prefix}) AND expires_at > ${Date.now()}`
            return z.coerce.number().parse(rows[0]?.count)
          }
        }
        return { value: await work(operations) }
      })
      return result.value
    }
  }
}
