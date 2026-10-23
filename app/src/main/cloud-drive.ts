import { randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { CloudDrive } from '../shared/api'

export async function detectCloudDrives({ platform, home, driveRoots = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`) }: {
  platform: NodeJS.Platform
  home: string
  driveRoots?: string[]
}): Promise<CloudDrive[]> {
  const drives: CloudDrive[] = []
  const add = async (folder: string, label: CloudDrive['label']) => {
    if ((await fs.stat(folder).catch(() => null))?.isDirectory()) drives.push({ folder, label })
  }
  if (platform === 'darwin') {
    await add(join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'), 'iCloud Drive')
    const storage = join(home, 'Library', 'CloudStorage')
    for (const entry of await fs.readdir(storage).catch(() => [])) {
      if (entry.startsWith('GoogleDrive-')) await add(join(storage, entry, 'My Drive'), 'Google Drive')
    }
  } else if (platform === 'win32') {
    await add(join(home, 'iCloudDrive'), 'iCloud Drive')
    await add(join(home, 'Google Drive'), 'Google Drive')
    for (const root of driveRoots) await add(join(root, 'My Drive'), 'Google Drive')
  }
  return drives
}

/** Streamed, not cloned, so a slow drive reports `pct` (0-100) as it goes and the copy can be stopped. */
async function copyWithProgress(source: string, target: string, signal?: AbortSignal, onProgress?: (pct: number) => void): Promise<void> {
  const size = (await fs.stat(source)).size
  let copied = 0
  let reported = -1
  const count = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      copied += chunk.length
      const pct = size ? Math.floor((copied * 100) / size) : 100
      if (pct !== reported) onProgress?.((reported = pct))
      done(null, chunk)
    }
  })
  await pipeline(createReadStream(source), count, createWriteStream(target, { flags: 'wx' }), { signal })
}

export async function copyToCloudDrive(source: string, folder: string, { signal, onProgress }: { signal?: AbortSignal; onProgress?: (pct: number) => void } = {}): Promise<string> {
  const destination = join(folder, 'Reel Studio')
  await fs.mkdir(destination, { recursive: true })
  const temp = join(destination, `.${randomUUID()}.tmp`)
  const ext = extname(source)
  const stem = basename(source, ext)
  for (let n = 1; ; n++) {
    const target = join(destination, `${stem}${n === 1 ? '' : ` (${n})`}${ext}`)
    let reservation
    try {
      reservation = await fs.open(target, 'wx')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue
      throw error
    }
    try {
      await reservation.close()
      await copyWithProgress(source, temp, signal, onProgress)
      await fs.rename(temp, target)
      return target
    } catch (error) {
      await Promise.all([fs.rm(temp, { force: true }), fs.rm(target, { force: true })])
      throw error
    }
  }
}
