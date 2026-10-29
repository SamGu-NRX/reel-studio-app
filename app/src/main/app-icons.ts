// The real icons of Final Cut Pro and Premiere Pro beside their names in "Learn from my past edits", taken from the
// installed apps. Nothing is drawn to look like them; when an app isn't installed the sheet shows a neutral icon.
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { PastEdit } from '../shared/api'

type App = PastEdit['app']

export interface IconDeps {
  platform: NodeJS.Platform
  /** Paths Spotlight matches, or null when it can't be asked. */
  spotlight: ((query: string) => Promise<string[] | null>) | null
  /** A registry key's default value, or null (Windows). */
  registry: ((key: string) => Promise<string | null>) | null
  /** Folders apps are installed in: /Applications on a Mac, Program Files on Windows. */
  appFolders: string[]
  /** The file's icon as a data URL, or null. */
  fileIcon: (path: string) => Promise<string | null>
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false)

/** The first folder entry whose name starts with `prefix`, newest version last in name order. */
async function newest(dir: string, prefix: string): Promise<string | null> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.startsWith(prefix)).sort()
  return names.length ? join(dir, names[names.length - 1]) : null
}

async function locate(app: App, deps: IconDeps): Promise<string | null> {
  if (deps.platform === 'darwin') {
    const id = app === 'Final Cut Pro' ? 'com.apple.FinalCut' : 'com.adobe.PremierePro*'
    const found = (await deps.spotlight?.(`kMDItemCFBundleIdentifier == "${id}"`))?.find((p) => p.endsWith('.app'))
    if (found) return found
    for (const dir of deps.appFolders) {
      if (app === 'Final Cut Pro') {
        if (await exists(join(dir, 'Final Cut Pro.app'))) return join(dir, 'Final Cut Pro.app')
        continue
      }
      // Adobe installs "Adobe Premiere Pro 2026/Adobe Premiere Pro 2026.app"
      const folder = await newest(dir, 'Adobe Premiere Pro')
      const bundle = folder && (await newest(folder, 'Adobe Premiere Pro'))
      if (bundle?.endsWith('.app')) return bundle
    }
    return null
  }
  if (deps.platform !== 'win32' || app !== 'Premiere Pro') return null
  const registered = await deps.registry?.('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Adobe Premiere Pro.exe')
  if (registered && (await exists(registered))) return registered
  for (const dir of deps.appFolders) {
    const folder = await newest(join(dir, 'Adobe'), 'Adobe Premiere Pro')
    if (folder && (await exists(join(folder, 'Adobe Premiere Pro.exe')))) return join(folder, 'Adobe Premiere Pro.exe')
  }
  return null
}

/** Each installed editor's icon as a data URL; an app that isn't installed, or whose icon can't be read, is left out. */
export async function appIcons(deps: IconDeps): Promise<Partial<Record<App, string>>> {
  const out: Partial<Record<App, string>> = {}
  for (const app of ['Final Cut Pro', 'Premiere Pro'] as const) {
    const path = await locate(app, deps)
    const icon = path && (await deps.fileIcon(path).catch(() => null))
    if (icon) out[app] = icon
  }
  return out
}

/** `reg query <key> /ve`: the key's default value, or null. */
export function regDefault(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', key, '/ve'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : (/REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(stdout)?.[1].trim().replace(/^"|"$/g, '') ?? null))
    })
  })
}
