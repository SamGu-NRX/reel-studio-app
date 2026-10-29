// "Learn from my past edits" lists the Final Cut Pro and Premiere Pro edits already on this computer, so the
// person ticks them instead of hunting through a file dialog (Sam opened that dialog twice and cancelled both).
// On a Mac Spotlight finds them anywhere it indexes, external drives included; a walk of the usual folders runs
// on every system, so a Mac with Spotlight off, and Windows, still find what sits where the editors save.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type { PastEdit, PastEditKind } from '../shared/api'

export interface FindDeps {
  platform: NodeJS.Platform
  home: string
  /** Every path Spotlight matches for a query, or null when Spotlight can't be asked (not a Mac, or it failed). */
  spotlight: ((query: string) => Promise<string[] | null>) | null
}

/** A found edit with the path main keeps; the page gets the PastEdit part, never the path. */
export interface Found extends PastEdit {
  path: string
}

const KIND: Record<string, { kind: PastEditKind; app: PastEdit['app']; folder: boolean }> = {
  '.fcpxml': { kind: 'fcpxml', app: 'Final Cut Pro', folder: false },
  '.fcpxmld': { kind: 'fcpxmld', app: 'Final Cut Pro', folder: true },
  '.fcpbundle': { kind: 'fcpbundle', app: 'Final Cut Pro', folder: true },
  '.prproj': { kind: 'prproj', app: 'Premiere Pro', folder: false },
  '.xml': { kind: 'premiere-xml', app: 'Premiere Pro', folder: false }
}
/** What the engine's import-reference reads; a library or a Premiere project needs an XML export first. */
const READABLE = new Set<PastEditKind>(['fcpxml', 'fcpxmld', 'premiere-xml'])

// Folders the walk starts from, under the home folder. Final Cut Pro keeps libraries in Movies; Premiere Pro keeps
// projects in Documents\Adobe\Premiere Pro\<version>; exports land wherever the person saved them, usually below.
const START: Record<'darwin' | 'other', string[]> = {
  darwin: ['Movies', 'Documents', 'Desktop', 'Downloads'],
  other: ['Videos', 'Documents', 'Desktop', 'Downloads', join('OneDrive', 'Documents'), join('OneDrive', 'Desktop')]
}
const DEPTH = 5
/** Directory entries one walk looks at before it stops, so a huge Documents folder can't hold the list up. */
const WALK_BUDGET = 20_000
/** .xml files sniffed for a Premiere export, newest first; the rest of a folder full of XML is not looked at. */
const XML_SNIFF = 400
const XML_MAX_BYTES = 64 * 1024 * 1024
// Folders that never hold an edit the person made: app data, packages of other apps, caches and the editors'
// own backups and auto-saves (copies of a project already listed).
const SKIP_DIR = /^(\.|node_modules$|Library$|AppData$|Applications$|\$RECYCLE\.BIN$|Adobe Premiere Pro (Auto-Save|Video Previews|Audio Previews)$|Media Cache( Files)?$|Final Cut Backups)/i
const PACKAGE = /\.(app|photoslibrary|imovielibrary|tvlibrary|musiclibrary|bundle|framework|lrdata|lrcat-data)$/i
const SYSTEM = /^\/(System|Library|Applications|private|usr|opt|bin|sbin|cores|dev)\//
// a path inside another package or bundle (an Info.fcpxml in a .fcpxmld, a project inside a library)
const INSIDE = /\.(fcpxmld|fcpbundle|prproj|app|photoslibrary|bundle)[\\/]/i

const SPOTLIGHT_QUERIES = [
  ['fcpxml', 'fcpxmld', 'fcpbundle', 'prproj'].map((x) => `kMDItemFSName == "*.${x}"c`).join(' || '),
  `kMDItemFSName == "*.xml"c && kMDItemFSSize < ${XML_MAX_BYTES}`
]

const idOf = (path: string): string => createHash('sha256').update(path).digest('hex').slice(0, 16)

function excluded(path: string, home: string): boolean {
  if (INSIDE.test(path) || /[\\/]\.Trash(es)?[\\/]/.test(path)) return true
  const rel = relative(home, path)
  return rel.startsWith('..') ? SYSTEM.test(path) : rel.split(sep).some((part) => SKIP_DIR.test(part))
}

/** Where it is, in words: the folder below the home folder ("Movies › Exports"), or the drive and folder. */
function whereOf(path: string, home: string): string {
  const parent = dirname(path)
  const rel = relative(home, parent)
  if (!rel) return 'Home folder'
  const parts = rel.startsWith('..') ? parent.replace(/^\/Volumes\//, '').split(/[\\/]+/).filter(Boolean) : rel.split(sep)
  return parts.join(' › ')
}

async function walk(home: string, platform: NodeJS.Platform): Promise<string[]> {
  const hits: string[] = []
  let budget = WALK_BUDGET
  const queue: { dir: string; depth: number }[] = START[platform === 'darwin' ? 'darwin' : 'other'].map((d) => ({ dir: join(home, d), depth: 0 }))
  while (queue.length && budget > 0) {
    const { dir, depth } = queue.shift()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (--budget <= 0) break
      const full = join(dir, e.name)
      const ext = extname(e.name).toLowerCase()
      if (e.isDirectory()) {
        if (KIND[ext]?.folder) hits.push(full)
        else if (depth < DEPTH && !SKIP_DIR.test(e.name) && !PACKAGE.test(e.name)) queue.push({ dir: full, depth: depth + 1 })
      } else if (e.isFile() && KIND[ext] && !KIND[ext].folder) hits.push(full)
    }
  }
  return hits
}

async function isPremiereXml(path: string): Promise<boolean> {
  const fh = await open(path, 'r').catch(() => null)
  if (!fh) return false
  try {
    const buf = Buffer.alloc(2048)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    // FCP7 XML, which Premiere Pro writes for File › Export › Final Cut Pro XML: `<xmeml version="4">`
    return /<xmeml[\s>]/.test(buf.subarray(0, bytesRead).toString('utf8'))
  } finally {
    await fh.close()
  }
}

/** Every edit found, newest first. Paths that vanish or can't be read between finding and looking are left out. */
export async function findPastEdits(deps: FindDeps): Promise<Found[]> {
  const fromSpotlight = deps.spotlight ? await Promise.all(SPOTLIGHT_QUERIES.map((q) => deps.spotlight!(q))) : []
  const paths = new Set([...fromSpotlight.flat().filter((p): p is string => !!p), ...(await walk(deps.home, deps.platform))])
  const seen = await Promise.all(
    [...paths]
      .filter((p) => KIND[extname(p).toLowerCase()] && !excluded(p, deps.home))
      .map(async (path) => {
        const st = await stat(path).catch(() => null)
        const k = KIND[extname(path).toLowerCase()]
        if (!st || st.isDirectory() !== k.folder) return null
        return { path, st, k }
      })
  )
  const candidates = seen.filter((x) => x !== null).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
  // XML is everywhere; only the newest are opened to see whether Premiere Pro wrote them
  const xml = candidates.filter((c) => c.k.kind === 'premiere-xml' && c.st.size <= XML_MAX_BYTES).slice(0, XML_SNIFF)
  const premiere = new Set((await Promise.all(xml.map(async (c) => ((await isPremiereXml(c.path)) ? c.path : null)))).filter(Boolean))
  return candidates
    .filter((c) => c.k.kind !== 'premiere-xml' || premiere.has(c.path))
    .map(({ path, st, k }) => ({
      id: idOf(path),
      path,
      name: basename(path, extname(path)),
      file: basename(path),
      where: whereOf(path, deps.home),
      app: k.app,
      kind: k.kind,
      modified: st.mtime.toISOString(),
      readable: READABLE.has(k.kind)
    }))
}

/** Spotlight through `mdfind`, or null when it fails, so the folder walk alone decides. */
export function mdfind(query: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile('mdfind', [query], { timeout: 8000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout.split('\n').filter(Boolean))
    })
  })
}

/** The engine's reference-scan result, paired back to the edits by path. */
export function countsOf(found: Found[], scanned: unknown): Record<string, { timelines: number } | { problem: string }> {
  const files = (scanned as { files?: unknown } | null)?.files
  if (!Array.isArray(files)) throw new Error('reference-scan returned no files list')
  const byPath = new Map(found.map((f) => [f.path, f.id]))
  const out: Record<string, { timelines: number } | { problem: string }> = {}
  for (const f of files as { path?: unknown; timelines?: unknown; error?: { message?: unknown } }[]) {
    const id = typeof f.path === 'string' ? byPath.get(f.path) : undefined
    if (!id) continue
    if (typeof f.timelines === 'number') out[id] = { timelines: f.timelines }
    else if (typeof f.error?.message === 'string') out[id] = { problem: f.error.message }
  }
  return out
}
