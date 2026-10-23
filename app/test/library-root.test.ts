import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { initPaths, reelStudioRoot, setRootOverride, settingsFile } from '../src/main/paths'
import { saveSettings, settleLibraryRoot } from '../src/main/settings'
import { APP_DIR } from './helpers'

function home(): { documents: string; movies: string } {
  const base = mkdtempSync(join(tmpdir(), 'rs-root-'))
  const documents = join(base, 'Documents')
  const movies = join(base, 'Movies')
  initPaths({ isPackaged: false, resourcesPath: '', documentsDir: documents, moviesDir: movies, userDataDir: join(base, 'user data'), appDir: APP_DIR, env: {} })
  return { documents, movies }
}

async function launch(): Promise<string> {
  const root = await settleLibraryRoot()
  setRootOverride(root)
  return reelStudioRoot()
}

describe('the library folder', () => {
  it('fails if an existing library in Documents is moved or ignored', async () => {
    const { documents, movies } = home()
    const project = join(documents, 'Reel Studio', 'Projects', 'sourdough', 'project.json')
    mkdirSync(dirname(project), { recursive: true })
    writeFileSync(project, '{"title":"Sourdough"}')
    mkdirSync(dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify({ firstRunDone: true }))

    expect(await launch()).toBe(join(documents, 'Reel Studio'))
    expect(await launch()).toBe(join(documents, 'Reel Studio'))
    expect(readFileSync(project, 'utf8')).toBe('{"title":"Sourdough"}')
    expect(existsSync(join(movies, 'Reel Studio'))).toBe(false)
  })

  it('fails if a new install does not use ~/Movies, or switches folders on a later launch', async () => {
    const { movies } = home()
    expect(await launch()).toBe(join(movies, 'Reel Studio'))
    await saveSettings({ firstRunDone: true }) // the first session writes settings, as every session does
    expect(await launch()).toBe(join(movies, 'Reel Studio'))
  })

  it('fails if a folder the person chose is replaced by a default', async () => {
    home()
    const chosen = join(tmpdir(), 'Elsewhere', 'Reel Studio')
    mkdirSync(dirname(settingsFile()), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify({ firstRunDone: true, root: chosen }))
    expect(await launch()).toBe(chosen)
  })
})
