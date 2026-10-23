// Settings › Advanced › Cache: the size of the engine's cache folder (paths.ts engineCacheDir) and clearing it.
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

/**
 * The files the engine writes in its cache folder, by name: assets.py's JSON books with their `.lock` and
 * `.<pid>.part` files, and music.py's song analysis (`<32 hex>.json`, `<32 hex>.<id>.part`) in music-analysis.
 * Only files with these names are counted and cleared, never a folder or anything else, because
 * REELENGINE_CACHE_DIR can point anywhere.
 */
const BOOK = /^(simple-icons|wikidata|search-credits)\.json(\.lock|\.\d+\.part)?$/
const SONG = /^[0-9a-f]{32}(\.json|\.\d+\.part)$/
const SONGS = 'music-analysis'

async function files(dir: string, name: RegExp): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []
    throw e
  })
  return entries.filter((e) => e.isFile() && name.test(e.name)).map((e) => join(dir, e.name))
}

const engineFiles = async (dir: string): Promise<string[]> => [...(await files(dir, BOOK)), ...(await files(join(dir, SONGS), SONG))]

/** Bytes the engine's cache takes up in `dir`; 0 when the folder isn't there yet. */
export async function engineCacheSize(dir: string): Promise<number> {
  let total = 0
  for (const f of await engineFiles(dir)) total += (await fs.stat(f).catch(() => ({ size: 0 }))).size
  return total
}

/** Deletes what the engine cached in `dir`. The engine rebuilds it as it needs it. */
export async function clearEngineCache(dir: string): Promise<void> {
  for (const f of await engineFiles(dir)) await fs.rm(f, { force: true })
}
