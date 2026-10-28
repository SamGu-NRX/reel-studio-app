import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearFailedCopy, POSTER, titleWithAnotherVideo } from '../src/main/first-video'

function reelDir(withVersion: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'rs-first-video-'))
  writeFileSync(join(dir, 'app.json'), '{"title":"Sourdough","plan":{}}')
  writeFileSync(join(dir, 'project.json'), '{}')
  writeFileSync(join(dir, POSTER), 'jpg')
  for (const sub of ['media', 'work', join('versions', withVersion ? 'v1' : 'preview')]) mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'media', 'take01.mp4'), 'video')
  return dir
}

describe('another video after a failed Version 1', () => {
  // fails if choosing another video leaves the old copy (the engine then refuses with PROJECT_EXISTS) or loses the
  // reel's title, plan and chat
  it('removes the copy, its caches and the poster, and keeps app.json', async () => {
    const dir = reelDir(false)
    try {
      await clearFailedCopy(dir)
      expect(readdirSync(dir)).toEqual(['app.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // fails if a reel with a version can lose the copy its versions were made from
  it('refuses a reel that has a version, and removes nothing', async () => {
    const dir = reelDir(true)
    try {
      await expect(clearFailedCopy(dir)).rejects.toMatchObject({ code: 'HAS_VIDEO' })
      expect(existsSync(join(dir, 'media', 'take01.mp4'))).toBe(true)
      expect(existsSync(join(dir, 'project.json'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// fails if another video renames a reel the person named, or one with no record of its file's title
it('keeps a name the reel was given when another video comes in, and takes the new file’s title otherwise', () => {
  expect(titleWithAnotherVideo('Screen recording', 'Screen recording', 'My first take')).toBe('My first take')
  expect(titleWithAnotherVideo('Morning routine', 'Screen recording', 'My first take')).toBe('Morning routine')
  expect(titleWithAnotherVideo('Screen recording', undefined, 'My first take')).toBe('Screen recording')
})
