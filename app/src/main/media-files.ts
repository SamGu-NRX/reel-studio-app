// Media the page may show, for both ways it can ask: the desktop window's reel-media: protocol (media.ts) and a
// browser's GET /media/<ref> (server/http.ts). One resolver, so both refuse the same things. No electron import.
//
// A ref is a path from the Reel Studio folder (shared/media-ref.ts). Serving checks it on disk: the real path
// (symlinks followed) must stay inside <root>/Projects or <root>/Library, be a regular file, and have a media
// extension. The old reel-media: check compared paths as text only, so a symlink inside a project could point
// anywhere on the disk.
import { realpathSync, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, sep } from 'node:path'
import type { MediaRef } from '../shared/api'
import { MEDIA_TOP, refFromSegments, segmentsFromRef } from '../shared/media-ref'
import { reelStudioRoot } from './paths'

export const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg'
}

const isMedia = (file: string): boolean => extname(file).toLowerCase() in MEDIA_TYPES

/** The ref for a file under the root, or null when it is outside it or not a media file. */
export function mediaRef(absPath: string, bust?: number): MediaRef | null {
  const rel = relative(reelStudioRoot(), absPath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !isMedia(absPath)) return null
  const segments = rel.split(sep)
  if (!(MEDIA_TOP as readonly string[]).includes(segments[0])) return null
  return refFromSegments(segments, bust)
}

export type ResolvedMedia = { ok: true; file: string; type: string; size: number } | { ok: false; status: 400 | 403 | 404 }

function realOrNull(p: string): string | null {
  try {
    return realpathSync.native(p)
  } catch {
    return null
  }
}

const within = (dir: string, file: string): boolean => file.startsWith(dir.endsWith(sep) ? dir : dir + sep)

/** Ref -> the file to stream. 400 = not a ref, 403 = escapes the allowed folders, 404 = no such media file.
 * Synchronous on purpose: drag-out (index.ts) must call startDrag in the same turn. */
export function resolveMediaRef(ref: string): ResolvedMedia {
  const segments = segmentsFromRef(ref)
  if (!segments) return { ok: false, status: 400 }
  if (!isMedia(segments[segments.length - 1])) return { ok: false, status: 404 }
  const root = reelStudioRoot()
  const top = realOrNull(join(root, segments[0]))
  const file = realOrNull(join(root, ...segments))
  if (!top || !file) return { ok: false, status: 404 }
  if (!within(top, file)) return { ok: false, status: 403 }
  let st
  try {
    st = statSync(file)
  } catch {
    return { ok: false, status: 404 }
  }
  if (!st.isFile()) return { ok: false, status: 404 }
  return { ok: true, file, type: MEDIA_TYPES[extname(file).toLowerCase()], size: st.size }
}

/**
 * One `Range: bytes=` header against a file size. null = no usable range (send the whole file), 'unsatisfiable' = 416.
 * Only a single range: a multi-range request gets the whole file, which RFC 9110 allows.
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return null
  const first = m[1] ? Number(m[1]) : null
  const last = m[2] ? Number(m[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return 'unsatisfiable'
  if (first !== null && last !== null && last < first) return null
  if (first === null) {
    // a suffix: the last N bytes
    if (last === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - last!), end: size - 1 }
  }
  if (first >= size) return 'unsatisfiable'
  return { start: first, end: last === null || last >= size ? size - 1 : last }
}
