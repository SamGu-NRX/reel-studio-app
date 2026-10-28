// The nightly is its own app beside the stable one (shared/channel.ts): the version alone picks the channel, the
// build gives it its own identity, its data stays apart except the shared speech models, its library never touches
// the stable app's reels, and its updater follows only the fork's nightly releases.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { channelOf } from '../src/shared/channel'
import { clearEngineCache } from '../src/main/engine-cache'
import { chosenRoot, engineCacheDir, engineEnv, initPaths, modelsDir, reelStudioRoot, setRootOverride, settingsFile } from '../src/main/paths'
import { settleLibraryRoot } from '../src/main/settings'
import { allowedReleaseUrl, newerRelease, pageFor, type FetchLike } from '../src/main/update-check'
import { updateMode } from '../src/main/update-machine'
import { APP_DIR } from './helpers'

const { channelConfig, applyOverrides } = createRequire(import.meta.url)('../../packaging/make-config.js') as {
  channelConfig(version: string): { channel: string; overrides: string[]; icons: string; releases: { owner: string; repo: string } }
  applyOverrides(yaml: string, overrides: string[]): string
}
const TEMPLATE = readFileSync(join(APP_DIR, '..', 'packaging', 'electron-builder.yml'), 'utf8')
const NIGHTLY = '0.1.3-nightly.20261028.17'

describe('channel', () => {
  it('fails if a version lands on the wrong channel, or the build and the running app disagree', () => {
    const cases: [string, 'stable' | 'nightly'][] = [
      ['0.1.2', 'stable'],
      ['1.0.0-beta.1', 'stable'],
      [NIGHTLY, 'nightly'],
      ['0.1.4-nightly.20261231.3824', 'nightly'],
      ['0.1.3-nightly.2026102.1', 'stable'], // seven-digit date
      ['0.1.3-nightly.20261028', 'stable'], // no run number
      ['0.1.3-nightly.20261028.x', 'stable'],
      ['0.1.3-nightly.20261028.17-x', 'stable']
    ]
    for (const [version, channel] of cases) {
      expect(channelOf(version), version).toBe(channel)
      expect(channelConfig(version).channel, `make-config.js ${version}`).toBe(channel)
    }
  })

  it('fails if a nightly build shares the stable app\'s identity, install folder or releases', () => {
    const yml = applyOverrides(TEMPLATE, channelConfig(NIGHTLY).overrides)
    expect(yml).toMatch(/^appId: dev\.reelstudio\.app\.nightly$/m)
    expect(yml).toMatch(/^productName: Reel Studio \(Nightly\)$/m)
    // the packaged package.json: Electron's userData folder, the Windows install folder, electron-updater's cache
    expect(yml).toMatch(/^extraMetadata:\n {2}name: reel-studio-nightly\n {2}productName: Reel Studio \(Nightly\)\n/m)
    expect(yml).toMatch(/^dmg:\n(?: {2}.*\n)*? {2}artifactName: Reel-Studio-Nightly-\$\{version\}-\$\{arch\}\.\$\{ext\}$/m)
    expect(yml).toMatch(/^nsis:\n(?: {2}.*\n|\s*\n)*? {2}artifactName: Reel-Studio-Nightly-Setup-\$\{version\}-\$\{arch\}\.\$\{ext\}/m)
    expect(channelConfig(NIGHTLY).icons).toBe('packaging/icons/nightly')
    expect(channelConfig(NIGHTLY).releases).toEqual({ owner: 'SamGu-NRX', repo: 'reel-studio-app' })

    expect(applyOverrides(TEMPLATE, channelConfig('0.1.2').overrides)).toBe(TEMPLATE)
    expect(channelConfig('0.1.2').releases).toEqual({ owner: 'AidenJohnston', repo: 'reel-studio-app' })
  })
})

/** A computer with the stable app's data and library already there, and the nightly about to start. */
function computer(platform: NodeJS.Platform, channel: 'stable' | 'nightly' = 'nightly', env: NodeJS.ProcessEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), 'rs-nightly-'))
  const appData = platform === 'win32' ? join(home, 'AppData', 'Roaming') : join(home, 'Library', 'Application Support')
  const stable = { userData: join(appData, 'Reel Studio'), documents: join(home, 'Documents', 'Reel Studio'), movies: join(home, 'Movies', 'Reel Studio') }
  const project = join(stable.documents, 'Projects', 'sourdough', 'project.json')
  mkdirSync(join(project, '..'), { recursive: true })
  writeFileSync(project, '{"title":"Sourdough"}')
  mkdirSync(join(stable.userData, 'models', 'small.en'), { recursive: true })
  writeFileSync(join(stable.userData, 'models', 'small.en', 'model.bin'), 'weights')
  writeFileSync(join(stable.userData, 'settings.json'), JSON.stringify({ firstRunDone: true, root: stable.documents }))
  const userData = join(appData, channel === 'nightly' ? 'Reel Studio (Nightly)' : 'Reel Studio')
  initPaths({
    isPackaged: true,
    resourcesPath: '',
    documentsDir: join(home, 'Documents'),
    moviesDir: join(home, 'Movies'),
    userDataDir: userData,
    appDataDir: appData,
    appDir: APP_DIR,
    channel,
    platform,
    homeDir: home,
    env: platform === 'win32' ? { LOCALAPPDATA: join(home, 'AppData', 'Local'), ...env } : env
  })
  return { home, appData, userData, stable, project }
}

describe('nightly data', () => {
  it('fails if the nightly downloads its own copy of the speech models instead of using the stable app\'s, on a Mac or on Windows', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const c = computer(platform)
      expect(modelsDir(), platform).toBe(join(c.appData, 'Reel Studio', 'models'))
      expect(engineEnv().REELENGINE_MODELS, platform).toBe(join(c.appData, 'Reel Studio', 'models'))
    }
    // the stable app and an isolated test profile keep their own
    const s = computer('darwin', 'stable')
    expect(modelsDir()).toBe(join(s.userData, 'models'))
    const t = computer('darwin', 'nightly', { REELSTUDIO_USER_DATA: '/isolated/profile' })
    expect(modelsDir()).toBe(join(t.userData, 'models'))
  })

  it('fails if the nightly\'s engine writes its caches into the stable app\'s folders, or Clear cache empties them', async () => {
    const s = computer('darwin', 'stable')
    const stableCache = engineCacheDir()
    mkdirSync(stableCache, { recursive: true })
    writeFileSync(join(stableCache, 'simple-icons.json'), 'stable lookups')

    initPaths(nightlyContext(s))
    expect(engineCacheDir()).not.toBe(stableCache)
    // the engine's own fallback (tools.appdata_dir) is the stable app's folder
    expect(engineEnv().REELENGINE_CACHE).toBe(join(s.appData, 'Reel Studio (Nightly)'))

    await clearEngineCache(engineCacheDir())
    expect(readFileSync(join(stableCache, 'simple-icons.json'), 'utf8')).toBe('stable lookups')
    expect(readFileSync(join(modelsDir(), 'small.en', 'model.bin'), 'utf8')).toBe('weights')
  })
})

/** The nightly on the same computer as `c`, which was set up for the stable app. */
function nightlyContext(c: ReturnType<typeof computer>) {
  return {
    isPackaged: true,
    resourcesPath: '',
    documentsDir: join(c.home, 'Documents'),
    moviesDir: join(c.home, 'Movies'),
    userDataDir: join(c.appData, 'Reel Studio (Nightly)'),
    appDataDir: c.appData,
    appDir: APP_DIR,
    channel: 'nightly' as const,
    platform: 'darwin' as const,
    homeDir: c.home,
    env: {}
  }
}

describe('nightly library', () => {
  it('fails if the nightly\'s first launch adopts the stable app\'s library in Documents or Movies', async () => {
    const c = computer('darwin')
    mkdirSync(c.stable.movies, { recursive: true })
    // a nightly settings file without a root (an older nightly, or one reset by hand) is not an install from before ~/Movies
    mkdirSync(join(settingsFile(), '..'), { recursive: true })
    writeFileSync(settingsFile(), JSON.stringify({ firstRunDone: true }))
    const root = await settleLibraryRoot()
    setRootOverride(root)
    expect(reelStudioRoot()).toBe(join(c.home, 'Movies', 'Reel Studio (Nightly)'))
    expect(readFileSync(c.project, 'utf8')).toBe('{"title":"Sourdough"}')
  })

  it('fails if Settings › Storage lets the nightly use a folder that is, holds or sits inside a stable library', () => {
    const c = computer('darwin')
    const custom = join(c.home, 'Elsewhere', 'Reel Studio')
    const stableRoots = [c.stable.documents, c.stable.movies, custom]
    for (const picked of [c.stable.documents, join(c.stable.documents, 'Projects'), custom]) {
      expect(() => chosenRoot(picked, stableRoots), picked).toThrow(/stable app's library/)
    }
    expect(chosenRoot(join(c.home, 'Documents'), stableRoots)).toBe(join(c.home, 'Documents', 'Reel Studio (Nightly)'))
    expect(existsSync(join(c.home, 'Documents', 'Reel Studio (Nightly)'))).toBe(false) // choosing only names it

    computer('darwin', 'stable')
    expect(chosenRoot(join(c.home, 'Documents'))).toBe(join(c.home, 'Documents', 'Reel Studio'))
  })
})

describe('nightly updates', () => {
  const FORK = 'https://github.com/SamGu-NRX/reel-studio-app/releases/tag/'
  const list = [
    { tag_name: 'v0.2.0', draft: false, html_url: 'https://github.com/AidenJohnston/reel-studio-app/releases/tag/v0.2.0' },
    { tag_name: 'sources-ffmpeg-7.1.1-rs2', draft: false },
    { tag_name: 'v0.1.3-nightly.20261028.17', draft: false, html_url: `${FORK}v0.1.3-nightly.20261028.17` },
    { tag_name: 'v0.1.3-nightly.20261028.19', draft: false, html_url: `${FORK}v0.1.3-nightly.20261028.19` },
    { tag_name: 'v0.1.3-nightly.20261028.18', draft: false, html_url: `${FORK}v0.1.3-nightly.20261028.18` },
    { tag_name: 'v0.1.3-nightly.20261029.20', draft: true },
    { tag_name: 'nightly-2026-10-28-d488f5e', draft: false }
  ]
  const github = () => {
    const urls: string[] = []
    const fetch: FetchLike = vi.fn(async (url: string) => {
      urls.push(url)
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => list }
    })
    return { fetch, urls }
  }

  it('fails if a nightly reads the main repo, misses a later run on the same day, or offers a stable release', async () => {
    const g = github()
    const r = await newerRelease(g.fetch, NIGHTLY)
    expect(g.urls).toEqual(['https://api.github.com/repos/SamGu-NRX/reel-studio-app/releases'])
    expect(r.update?.version).toBe('0.1.3-nightly.20261028.19')
    expect(r.update?.releaseUrl).toBe(`${FORK}v0.1.3-nightly.20261028.19`)
    expect(r.releases.map((x) => x.version)).toEqual(['0.1.3-nightly.20261028.19', '0.1.3-nightly.20261028.18', '0.1.3-nightly.20261028.17'])
    expect((await newerRelease(github().fetch, '0.1.3-nightly.20261028.19')).update).toBeNull()
    // a later date wins over a higher run number from an earlier day
    expect((await newerRelease(github().fetch, '0.1.3-nightly.20261027.99')).update?.version).toBe('0.1.3-nightly.20261028.19')
  })

  it('fails if the stable app sees a nightly, or a release page off its own repo opens', async () => {
    const g = github()
    const r = await newerRelease(g.fetch, '0.1.2')
    expect(g.urls).toEqual(['https://api.github.com/repos/AidenJohnston/reel-studio-app/releases'])
    expect(r.update?.version).toBe('0.2.0')
    expect(r.releases.map((x) => x.version)).toEqual(['0.2.0'])
    expect(allowedReleaseUrl(`${FORK}v0.1.3-nightly.20261028.19`)).toBeNull()
    expect(allowedReleaseUrl(`${FORK}v0.1.3-nightly.20261028.19`, 'nightly')).toBe(`${FORK}v0.1.3-nightly.20261028.19`)
    expect(allowedReleaseUrl('https://github.com/AidenJohnston/reel-studio-app/releases/tag/v0.2.0', 'nightly')).toBeNull()
    expect(pageFor('v0.1.3-nightly.20261028.19')).toBe(`${FORK}v0.1.3-nightly.20261028.19`)
  })

  it('fails if the ad-hoc signed Mac nightly tries to install an update itself instead of opening its page', () => {
    expect(updateMode({ platform: 'darwin', inApplications: true, hasFeed: true, channel: 'nightly' })).toBe('page')
    expect(updateMode({ platform: 'win32', inApplications: false, hasFeed: true, channel: 'nightly' })).toBe('install')
    expect(updateMode({ platform: 'darwin', inApplications: true, hasFeed: true, channel: 'stable' })).toBe('install')
  })
})
