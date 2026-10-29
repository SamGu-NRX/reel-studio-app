import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appIcons, type IconDeps } from '../src/main/app-icons'

const fresh = (): string => mkdtempSync(join(tmpdir(), 'app-icons-'))
const deps = (over: Partial<IconDeps>): IconDeps => ({
  platform: 'darwin',
  spotlight: null,
  registry: null,
  appFolders: [],
  fileIcon: async (p) => `icon:${p}`,
  ...over
})

describe('the editors’ own icons in Learn from my past edits', () => {
  it('leaves an editor out when it is not installed, so the sheet shows the neutral icon', async () => {
    expect(await appIcons(deps({ spotlight: async () => [], appFolders: [fresh()] }))).toEqual({})
    expect(await appIcons(deps({ platform: 'win32', registry: async () => null, appFolders: [fresh()] }))).toEqual({})
  })

  it('takes the app Spotlight finds by bundle id on a Mac, else the one in Applications', async () => {
    const asked: string[] = []
    const found = await appIcons(
      deps({
        spotlight: async (q) => {
          asked.push(q)
          return q.includes('com.apple.FinalCut') ? ['/Volumes/Apps/Final Cut Pro.app'] : []
        }
      })
    )
    expect(asked).toEqual(['kMDItemCFBundleIdentifier == "com.apple.FinalCut"', 'kMDItemCFBundleIdentifier == "com.adobe.PremierePro*"'])
    expect(found).toEqual({ 'Final Cut Pro': 'icon:/Volumes/Apps/Final Cut Pro.app' })

    const apps = fresh()
    mkdirSync(join(apps, 'Adobe Premiere Pro 2025', 'Adobe Premiere Pro 2025.app'), { recursive: true })
    mkdirSync(join(apps, 'Adobe Premiere Pro 2026', 'Adobe Premiere Pro 2026.app'), { recursive: true })
    mkdirSync(join(apps, 'Final Cut Pro.app'))
    expect(await appIcons(deps({ appFolders: [apps] }))).toEqual({
      'Final Cut Pro': `icon:${join(apps, 'Final Cut Pro.app')}`,
      'Premiere Pro': `icon:${join(apps, 'Adobe Premiere Pro 2026', 'Adobe Premiere Pro 2026.app')}`
    })
  })

  it('finds Premiere Pro on Windows from the registry, else in Program Files, and never Final Cut Pro', async () => {
    const pf = fresh()
    const exe = join(pf, 'Adobe', 'Adobe Premiere Pro 2026', 'Adobe Premiere Pro.exe')
    mkdirSync(join(pf, 'Adobe', 'Adobe Premiere Pro 2026'), { recursive: true })
    writeFileSync(exe, '')
    mkdirSync(join(pf, 'Final Cut Pro.app'))
    expect(await appIcons(deps({ platform: 'win32', registry: async () => exe }))).toEqual({ 'Premiere Pro': `icon:${exe}` })
    expect(await appIcons(deps({ platform: 'win32', registry: async () => null, appFolders: [pf] }))).toEqual({ 'Premiere Pro': `icon:${exe}` })
  })

  it('leaves out an icon the system can’t give', async () => {
    const apps = fresh()
    mkdirSync(join(apps, 'Final Cut Pro.app'))
    expect(await appIcons(deps({ appFolders: [apps], fileIcon: async () => { throw new Error('no icon') } }))).toEqual({})
    expect(await appIcons(deps({ appFolders: [apps], fileIcon: async () => null }))).toEqual({})
  })
})
