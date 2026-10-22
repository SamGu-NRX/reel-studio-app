/**
 * The open sidebar's width in px. 232 is the narrowest that still fits the lights, the toggle and the whole
 * "Reel Studio" wordmark on the title-bar row (finding 9); a stored width that is missing or not a number is the default.
 */
export const SIDE = { default: 248, min: 232, max: 360 } as const

export function sideWidth(stored: number | string | null): number {
  const w = Number(stored)
  if (stored === null || stored === '' || !Number.isFinite(w)) return SIDE.default
  return Math.round(Math.min(SIDE.max, Math.max(SIDE.min, w)))
}
