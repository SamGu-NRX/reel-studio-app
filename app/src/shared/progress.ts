// Time left and clock words, shared by the renderer and main (Dock / taskbar progress). Keep free of Node and
// DOM imports.

/**
 * "About 3 minutes left", from how fast the bar has moved so far. Says nothing until there is
 * enough to go on, rounds so it does not flicker, and never says "0 minutes".
 */
export function timeLeftText(secondsLeft: number | null): string | null {
  if (secondsLeft === null || !isFinite(secondsLeft) || secondsLeft < 0) return null
  if (secondsLeft < 20) return 'Almost done'
  if (secondsLeft < 60) return 'Less than a minute left'
  const mins = Math.round(secondsLeft / 60)
  if (mins <= 1) return 'About a minute left'
  if (mins < 60) return `About ${mins} minutes left`
  return 'More than an hour left'
}

/** Seconds left from the bar's speed so far. null = too early to say. */
export function estimateSecondsLeft(pct: number, elapsedSec: number): number | null {
  if (pct < 6 || elapsedSec < 8) return null
  return (elapsedSec / pct) * (100 - pct)
}

/** "0:16" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
