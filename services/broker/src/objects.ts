import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Environment } from './config.js'

export interface MediaObject { key: string; size: number; contentType: 'video/mp4' | 'image/jpeg' }
export interface ObjectStore {
  stage(object: MediaObject, now: number): Promise<{ upload_url: string; public_url: string }>
  remove(key: string): Promise<void>
}
// Ten minutes matches the desktop contract and stays below the fifteen-minute broker limit.
export const SIGNED_URL_SECONDS = 600
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client
  private readonly bucket: string
  constructor(config: Pick<Environment, 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'>) {
    this.bucket = config.S3_BUCKET
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT, region: config.S3_REGION, forcePathStyle: config.S3_FORCE_PATH_STYLE === 'true',
      credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED', maxAttempts: 1
    })
  }
  async stage(object: MediaObject, now: number) {
    const signingDate = new Date(now)
    const upload_url = await getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.bucket, Key: object.key, ContentType: object.contentType, ContentLength: object.size
    }), { expiresIn: SIGNED_URL_SECONDS, signingDate, signableHeaders: new Set(['content-type', 'content-length']) })
    const public_url = await getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket, Key: object.key, ResponseCacheControl: 'no-store'
    }), { expiresIn: SIGNED_URL_SECONDS, signingDate })
    return { upload_url, public_url }
  }
  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(8000) })
  }
}
