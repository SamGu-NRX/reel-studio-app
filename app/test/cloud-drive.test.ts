import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { copyToCloudDrive, detectCloudDrives } from '../src/main/cloud-drive'
import { driveNames } from '../src/shared/cloud-drive-names'

const scratch: string[] = []
async function temp() {
  const dir = await fs.mkdtemp(join(tmpdir(), 'rs-cloud-'))
  scratch.push(dir)
  return dir
}
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

it('fails if installed macOS cloud folders are not offered', async () => {
  const home = await temp()
  const iCloud = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')
  const google = join(home, 'Library', 'CloudStorage', 'GoogleDrive-Creator', 'My Drive')
  await fs.mkdir(iCloud, { recursive: true })
  await fs.mkdir(google, { recursive: true })
  expect(await detectCloudDrives({ platform: 'darwin', home })).toEqual([
    { folder: iCloud, label: 'iCloud Drive' }, { folder: google, label: 'Google Drive' }
  ])
  await fs.rm(iCloud, { recursive: true })
  expect((await detectCloudDrives({ platform: 'darwin', home })).map((drive) => drive.label)).toEqual(['Google Drive'])
})

it('fails if Windows cloud folders, the mirrored My Drive or the mounted Google Drive are missed or listed twice', async () => {
  const home = await temp()
  const mounted = join(home, 'G drive')
  const streamed = join(home, 'H drive')
  const mirrored = join(home, 'My Drive')
  const folders = [join(home, 'iCloudDrive'), join(home, 'Google Drive'), mirrored, join(mounted, 'My Drive')]
  for (const folder of folders) await fs.mkdir(folder, { recursive: true })
  await fs.mkdir(streamed)
  await fs.symlink(mirrored, join(streamed, 'My Drive'), 'junction')
  expect(await detectCloudDrives({ platform: 'win32', home, driveRoots: [mounted, streamed, join(home, 'missing drive')] })).toEqual(
    folders.map((folder, i) => ({ folder, label: i ? 'Google Drive' : 'iCloud Drive' }))
  )
})

it('fails if saving again or concurrently overwrites a reel', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  const cloud = join(dir, 'drive')
  await fs.mkdir(join(cloud, 'Reel Studio'), { recursive: true })
  await fs.writeFile(source, 'new video')
  const original = join(cloud, 'Reel Studio', basename(source))
  await fs.writeFile(original, 'previous video')
  const results = await Promise.all([copyToCloudDrive(source, cloud), copyToCloudDrive(source, cloud)])
  expect(results.map((file) => basename(file)).sort()).toEqual(['Family reel (2).mp4', 'Family reel (3).mp4'])
  expect(await fs.readFile(original, 'utf8')).toBe('previous video')
  for (const result of results) expect(await fs.readFile(result, 'utf8')).toBe('new video')
})

it('fails if a copy cancelled halfway exposes a partial reel or leaves its temporary file', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  const cloud = join(dir, 'drive')
  await fs.writeFile(source, Buffer.alloc(4_000_000, 7))
  const stop = new AbortController()
  const seen: number[] = []
  const copy = copyToCloudDrive(source, cloud, {
    signal: stop.signal,
    onProgress: (pct) => {
      seen.push(pct)
      if (pct > 0) stop.abort()
    }
  })
  await expect(copy).rejects.toThrow(/abort/i)
  expect(seen.at(-1)).toBeLessThan(100)
  expect(await fs.readdir(join(cloud, 'Reel Studio'))).toEqual([])
})

it('fails if a finished copy does not report 100 percent last', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  await fs.writeFile(source, Buffer.alloc(300_000, 1))
  const seen: number[] = []
  await copyToCloudDrive(source, join(dir, 'drive'), { onProgress: (pct) => seen.push(pct) })
  expect(seen.at(-1)).toBe(100)
  expect(seen).toEqual([...seen].sort((a, b) => a - b))
})

it('fails if a failed copy deletes a file the sync client put at the reel\'s name', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  const folder = join(dir, 'drive', 'Reel Studio')
  const target = join(folder, 'Family reel.mp4')
  await fs.writeFile(source, 'complete video')
  // the copy reports progress as it streams: the sync client puts a file at the name, then the disk fills
  const onProgress = (): void => {
    writeFileSync(join(folder, 'synced'), 'video from another device')
    renameSync(join(folder, 'synced'), target)
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
  }
  await expect(copyToCloudDrive(source, join(dir, 'drive'), { onProgress })).rejects.toThrow('disk full')
  expect(await fs.readdir(folder)).toEqual(['Family reel.mp4'])
  expect(await fs.readFile(target, 'utf8')).toBe('video from another device')
})

it('fails if one unresponsive drive letter holds up checking the others', async () => {
  const home = await temp()
  const slow = join(home, 'A drive')
  const fast = join(home, 'G drive')
  await fs.mkdir(join(slow, 'My Drive'), { recursive: true })
  await fs.mkdir(join(fast, 'My Drive'), { recursive: true })
  let fastChecked!: () => void
  const checked = new Promise<void>((resolve) => (fastChecked = resolve))
  const stat = fs.stat.bind(fs)
  // A disconnected network drive answers only after the other letters were looked at; checking one letter at a
  // time never gets there.
  vi.spyOn(fs, 'stat').mockImplementation((async (path: string, ...rest: []) => {
    if (path === join(slow, 'My Drive')) await checked
    if (path === join(fast, 'My Drive')) fastChecked()
    return stat(path, ...rest)
  }) as typeof fs.stat)
  const drives = await detectCloudDrives({ platform: 'win32', home, driveRoots: [slow, fast] })
  expect(drives.map((drive) => drive.folder)).toEqual([join(slow, 'My Drive'), join(fast, 'My Drive')])
}, 5000)

it('fails if a save replaces a file the sync client put at the reel\'s name while copying', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  const folder = join(dir, 'drive', 'Reel Studio')
  const taken = join(folder, 'Family reel.mp4')
  await fs.writeFile(source, 'complete video')
  // the sync client puts a file at the name while the copy streams
  let synced = false
  const onProgress = (): void => {
    if (synced) return
    synced = true
    writeFileSync(join(folder, 'synced'), 'video from another device')
    renameSync(join(folder, 'synced'), taken)
  }
  const saved = await copyToCloudDrive(source, join(dir, 'drive'), { onProgress })
  expect(basename(saved)).toBe('Family reel (2).mp4')
  expect(await fs.readFile(taken, 'utf8')).toBe('video from another device')
  expect(await fs.readFile(saved, 'utf8')).toBe('complete video')
  expect((await fs.readdir(folder)).sort()).toEqual(['Family reel (2).mp4', 'Family reel.mp4'])
})

it('fails if, on a drive without hard links, a save renames over a file that replaced its reservation', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  const folder = join(dir, 'drive', 'Reel Studio')
  const taken = join(folder, 'Family reel.mp4')
  await fs.writeFile(source, 'complete video')
  vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }))
  const stat = fs.stat.bind(fs)
  let replaced = false
  vi.spyOn(fs, 'stat').mockImplementation((async (path: string, ...rest: []) => {
    if (path === taken && !replaced) {
      replaced = true
      await fs.writeFile(join(folder, 'synced'), 'video from another device')
      await fs.rename(join(folder, 'synced'), taken)
    }
    return stat(path, ...rest)
  }) as typeof fs.stat)
  const saved = await copyToCloudDrive(source, join(dir, 'drive'))
  expect(basename(saved)).toBe('Family reel (2).mp4')
  expect(await fs.readFile(taken, 'utf8')).toBe('video from another device')
  expect(await fs.readFile(saved, 'utf8')).toBe('complete video')
  expect((await fs.readdir(folder)).sort()).toEqual(['Family reel (2).mp4', 'Family reel.mp4'])
})

it('fails if a button names a drive by its raw path or full email, or two buttons read the same', () => {
  const names = (...folders: string[]) => driveNames(folders.map((folder) => ({ folder, label: folder.includes('CloudDocs') || folder.endsWith('iCloudDrive') ? 'iCloud Drive' : 'Google Drive' })))
  const mac = '/Users/zoe/Library/CloudStorage'
  expect(names('/Users/zoe/Library/Mobile Documents/com~apple~CloudDocs', `${mac}/GoogleDrive-zoe.m@example.com/My Drive`)).toEqual(['iCloud Drive', 'Google Drive'])
  expect(names(`${mac}/GoogleDrive-zoe.m@example.com/My Drive`, `${mac}/GoogleDrive-studio@example.org/My Drive`)).toEqual(['Google Drive (zoe.m)', 'Google Drive (studio)'])
  expect(names(`${mac}/GoogleDrive-zoe@example.com/My Drive`, `${mac}/GoogleDrive-zoe@example.org/My Drive`)).toEqual(['Google Drive (zoe@example.com)', 'Google Drive (zoe@example.org)'])
  expect(names('C:\\Users\\Zoe\\iCloudDrive', 'G:\\My Drive', 'h:\\My Drive')).toEqual(['iCloud Drive', 'Google Drive (G:)', 'Google Drive (H:)'])
  expect(names('C:\\Users\\Zoe\\Google Drive', 'G:\\My Drive')).toEqual(['Google Drive (Google Drive folder)', 'Google Drive (G:)'])
})

it('fails if a save gives up when linking fails with an error other than EEXIST', async () => {
  const dir = await temp()
  const source = join(dir, 'Family reel.mp4')
  await fs.writeFile(source, 'complete video')
  // libuv's code for a file system without hard links, such as FAT32 or Google Drive's streaming drive letter.
  vi.spyOn(fs, 'link').mockRejectedValue(Object.assign(new Error('illegal operation on a directory'), { code: 'EISDIR' }))
  const saved = await copyToCloudDrive(source, join(dir, 'drive'))
  expect(saved).toBe(join(dir, 'drive', 'Reel Studio', 'Family reel.mp4'))
  expect(await fs.readFile(saved, 'utf8')).toBe('complete video')
  expect(await fs.readdir(join(dir, 'drive', 'Reel Studio'))).toEqual(['Family reel.mp4'])
})
