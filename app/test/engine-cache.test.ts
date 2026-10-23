import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { clearEngineCache, engineCacheSize } from '../src/main/engine-cache'
import { engineCacheDir, engineEnv, initPaths } from '../src/main/paths'
import { sizeLine } from '../src/shared/size'
import { APP_DIR, tempHome } from './helpers'

const SONG = '0123456789abcdef0123456789abcdef'

/** A cache folder as the engine leaves it (assets.py, music.py), plus things that only look like the engine's. */
function filledCache(): string {
  const dir = join(tempHome(), 'cache')
  mkdirSync(join(dir, 'music-analysis'), { recursive: true })
  writeFileSync(join(dir, 'simple-icons.json'), 'x'.repeat(100))
  writeFileSync(join(dir, 'search-credits.json.lock'), '')
  writeFileSync(join(dir, 'wikidata.json.123.part'), 'x'.repeat(20))
  writeFileSync(join(dir, 'music-analysis', `${SONG}.json`), 'x'.repeat(250))
  writeFileSync(join(dir, 'music-analysis', `${SONG}.4411.part`), 'x'.repeat(50))
  // not the engine's
  writeFileSync(join(dir, 'notes.txt'), 'x'.repeat(5000))
  writeFileSync(join(dir, 'simple-icons.json.backup'), 'x'.repeat(5000))
  mkdirSync(join(dir, 'wikidata.json', 'inside'), { recursive: true })
  writeFileSync(join(dir, 'music-analysis', 'my notes.json'), 'x'.repeat(5000))
  return dir
}

const tree = (dir: string): string[] => readdirSync(dir, { recursive: true }).map(String).sort()

describe('engine cache', () => {
  it('fails if the size leaves out what the engine cached, or counts a file that is not its own', async () => {
    expect(await engineCacheSize(filledCache())).toBe(420)
  })

  it('fails if Clear cache leaves engine files behind, or deletes the folder or a file the engine did not write', async () => {
    const dir = filledCache()
    await clearEngineCache(dir)
    expect(tree(dir)).toEqual(['music-analysis', join('music-analysis', 'my notes.json'), 'notes.txt', 'simple-icons.json.backup', 'wikidata.json', join('wikidata.json', 'inside')])
    expect(await engineCacheSize(dir)).toBe(0)
  })

  it('fails if a cache folder that was never made is an error', async () => {
    const dir = join(tempHome(), 'never made')
    expect(await engineCacheSize(dir)).toBe(0)
    await clearEngineCache(dir)
    expect(existsSync(dir)).toBe(false)
  })
})

describe('engineCacheDir', () => {
  const base = { isPackaged: false, resourcesPath: '', documentsDir: APP_DIR, moviesDir: APP_DIR, userDataDir: '/data/Reel Studio', appDir: APP_DIR, homeDir: '/Users/zoe' }

  it('fails if the engine is given a different cache folder from the one Settings measures and clears', () => {
    for (const env of [{}, { REELSTUDIO_USER_DATA: '/data/Reel Studio' }, { REELENGINE_CACHE_DIR: '/explicit/cache' }]) {
      initPaths({ ...base, platform: 'darwin', env })
      expect(engineEnv().REELENGINE_CACHE_DIR).toBe(engineCacheDir())
    }
  })

  it("fails if an install's cache moves away from the engine's own default, or an isolated profile shares it", () => {
    initPaths({ ...base, platform: 'darwin', env: {} })
    expect(engineCacheDir()).toBe('/Users/zoe/Library/Caches/ReelStudio')
    initPaths({ ...base, platform: 'linux', env: { XDG_CACHE_HOME: '/xdg' } })
    expect(engineCacheDir()).toBe('/xdg/reelstudio')
    initPaths({ ...base, platform: 'darwin', env: { REELSTUDIO_USER_DATA: '/data/Reel Studio' } })
    expect(engineCacheDir()).toBe(join('/data/Reel Studio', 'engine cache'))
    initPaths({ ...base, platform: 'darwin', env: { REELSTUDIO_USER_DATA: '/data/Reel Studio', REELENGINE_CACHE_DIR: '/explicit/cache' } })
    expect(engineCacheDir()).toBe('/explicit/cache')
  })
})

describe('sizeLine', () => {
  it('fails if a cache size reads wrong in Settings', () => {
    expect([0, 1, 420, 999_499, 999_500, 12_400_000, 999_499_999, 999_500_000, 1_250_000_000].map(sizeLine)).toEqual([
      'Empty',
      '1 KB',
      '1 KB',
      '999 KB',
      '1 MB',
      '12 MB',
      '999 MB',
      '1 GB',
      '1.3 GB'
    ])
  })
})
