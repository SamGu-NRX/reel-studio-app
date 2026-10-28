// A first video that didn't work: Version 1 failed before any version was made. Its card shows the video's first
// frame while there is no copy to show, and another video replaces the copy and starts Version 1 again.
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/** The first frame of the video the person brought in, kept beside app.json for its card (store.ts summary). */
export const POSTER = 'poster.jpg'

// A dropped file is untrusted input: local files and the video demuxers only, as library-preview.ts reads the Library.
const INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', 'mov,matroska,webm,avi']

/** Writes the video's first frame to `dir`/poster.jpg, 320 px wide (a card is 145 px at 2x). */
export function posterFrame(ffmpeg: string, video: string, dir: string): Promise<void> {
  const args = ['-nostdin', '-v', 'error', '-y', ...INPUT, '-i', video, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', join(dir, POSTER)]
  return new Promise((ok, fail) => execFile(ffmpeg, args, { timeout: 20_000, windowsHide: true }, (err) => (err ? fail(err) : ok())))
}

/**
 * Removes what a first edit that made no version left behind (the copy, its caches, the poster), so the engine can
 * copy in another video. app.json, with the title, the plan and the chat, stays. A reel with a version is refused:
 * its versions were made from that copy.
 */
export async function clearFailedCopy(dir: string): Promise<void> {
  const versions = await fs.readdir(join(dir, 'versions')).catch(() => [] as string[])
  if (versions.some((v) => /^v\d+$/.test(v))) {
    throw { code: 'HAS_VIDEO', userMessage: 'This reel already has a version. Drop the other video on Reels to make a new reel.' }
  }
  for (const name of ['project.json', 'media', 'work', 'versions', POSTER]) await fs.rm(join(dir, name), { recursive: true, force: true })
}
