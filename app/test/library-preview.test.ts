import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { binDir } from '../src/main/paths'
import { libraryPreview } from '../src/main/library-preview'
import { setupPaths } from './helpers'

describe('Library previews', () => {
  it('fails if a song that is really an ffconcat list makes ffmpeg read another file', async () => {
    setupPaths()
    const dir = binDir('music')
    mkdirSync(dir, { recursive: true })
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', join(dir, 'other.mp3')])
    const disguised = join(dir, 'my song.mp3')
    writeFileSync(disguised, 'ffconcat version 1.0\nfile other.mp3\n')
    await expect(libraryPreview(join(dir, 'other.mp3'))).resolves.toMatchObject({ durationSec: expect.any(Number) })
    await expect(libraryPreview(disguised)).rejects.toBeTruthy()
  }, 60_000)
})
