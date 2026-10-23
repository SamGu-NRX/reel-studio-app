// "New" on a Reels card: a version made after its reel was last on screen. Remembered in this window's storage.
const KEY = 'rs.seen'
// Versions made before this was first recorded count as watched: an existing library doesn't turn all New at once.
const SINCE = 'rs.seen-since'

const read = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

const since = (): string => {
  const s = localStorage.getItem(SINCE)
  if (s) return s
  const now = new Date().toISOString()
  localStorage.setItem(SINCE, now)
  return now
}

export function markSeen(slug: string): void {
  since()
  localStorage.setItem(KEY, JSON.stringify({ ...read(), [slug]: new Date().toISOString() }))
}

/** `versionAt`: when the reel's newest version was made. */
export function isNew(slug: string, versionAt: string | null): boolean {
  if (!versionAt) return false
  const seen = read()[slug]
  const after = seen && seen > since() ? seen : since()
  return versionAt > after
}
