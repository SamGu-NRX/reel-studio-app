import { z } from 'zod'

const httpsOrigin = z.string().url().refine(value => {
  const u = new URL(value)
  return u.protocol === 'https:' && u.origin === value
}, 'must be an HTTPS origin without a path')
const envSchema = z.object({
  BROKER_ORIGIN: httpsOrigin,
  INSTAGRAM_APP_ID: z.string().min(1), INSTAGRAM_APP_SECRET: z.string().min(1),
  TIKTOK_CLIENT_KEY: z.string().min(1), TIKTOK_CLIENT_SECRET: z.string().min(1),
  BROKER_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i),
  BROKER_DATABASE_URL: z.string().url(),
  S3_ENDPOINT: httpsOrigin, S3_REGION: z.string().min(1), S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1), S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
  CRON_SECRET: z.string().min(32),
  PRIVACY_CONTACT_EMAIL: z.string().email(),
  PRIVACY_OPERATOR_NAME: z.string().min(1)
})
export function readConfig(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env)
  if (!result.success) throw new Error(`Invalid broker environment: ${result.error.issues.map(issue => issue.path.join('.')).join(', ')}`)
  return result.data
}
export type Environment = ReturnType<typeof readConfig>
