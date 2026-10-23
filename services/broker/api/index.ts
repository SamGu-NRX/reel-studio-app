import { createBroker } from '../src/broker.js'
import { readConfig } from '../src/config.js'
import { postgresStore, Sealer } from '../src/store.js'
import { S3ObjectStore } from '../src/objects.js'

const config = readConfig(process.env)
const broker = createBroker({
  config: {
    brokerOrigin: config.BROKER_ORIGIN,
    instagramAppId: config.INSTAGRAM_APP_ID,
    instagramAppSecret: config.INSTAGRAM_APP_SECRET,
    tiktokClientKey: config.TIKTOK_CLIENT_KEY,
    tiktokClientSecret: config.TIKTOK_CLIENT_SECRET,
    cronSecret: config.CRON_SECRET,
    privacyContactEmail: config.PRIVACY_CONTACT_EMAIL,
    privacyOperatorName: config.PRIVACY_OPERATOR_NAME
  },
  store: postgresStore(config.BROKER_DATABASE_URL, new Sealer(Buffer.from(config.BROKER_ENCRYPTION_KEY, 'hex'))),
  objects: new S3ObjectStore(config),
  fetch
})
export default { fetch: broker }
