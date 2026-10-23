// A size on disk in words, in decimal units as Finder shows them.

export function sizeLine(bytes: number): string {
  if (bytes <= 0) return 'Empty'
  if (bytes < 999_500) return `${Math.max(1, Math.round(bytes / 1e3))} KB`
  if (bytes < 999_500_000) return `${Math.round(bytes / 1e6)} MB`
  return `${(bytes / 1e9).toFixed(1).replace(/\.0$/, '')} GB`
}
