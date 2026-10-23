// MediaRef (shared/api.ts): a file inside the Reel Studio folder, named by its path from that folder, each segment
// URL-encoded, plus an optional `?v=` that only busts caches. Keep free of Node and DOM imports: main makes and
// resolves refs (main/media-files.ts), the renderer only prefixes them (renderer/src/api.ts `mediaSrc`).
import type { MediaRef } from './api'

/** The desktop window's protocol for media: reel-media://f/<ref> (main/media.ts). */
export const MEDIA_SCHEME = 'reel-media'

/** The only folders under the root a ref may point into. */
export const MEDIA_TOP = ['Projects', 'Library'] as const

/** Segments relative to the root -> ref. */
export function refFromSegments(segments: string[], bust?: number): MediaRef {
  const q = bust ? `?v=${Math.round(bust)}` : ''
  return segments.map(encodeURIComponent).join('/') + q
}

/**
 * Ref -> decoded segments, or null for anything that is not a plain path down from the root: an empty, `.` or `..`
 * segment, a separator or NUL hidden in a segment, bad percent-encoding, or a first folder outside MEDIA_TOP.
 * Callers still have to check the file on disk (symlinks): this is only the shape.
 */
export function segmentsFromRef(ref: string): string[] | null {
  const path = ref.split(/[?#]/, 1)[0]
  if (!path || path.length > 4096) return null
  const out: string[] = []
  for (const raw of path.split('/')) {
    let s: string
    try {
      s = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (!s || s === '.' || s === '..' || /[\\/\u0000]/.test(s) || /^[a-zA-Z]:/.test(s)) return null
    out.push(s)
  }
  return (MEDIA_TOP as readonly string[]).includes(out[0]) && out.length > 1 ? out : null
}
