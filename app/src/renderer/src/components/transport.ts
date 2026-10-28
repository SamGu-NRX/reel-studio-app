import { useSyncExternalStore } from 'react'

/**
 * Play, pause, seek and speed for a player whose controls live outside it (the Reel screen's transport row and
 * timeline). The player attaches its own actions and reports its state; the controls call and read through here.
 */
export interface TransportState {
  playing: boolean
  duration: number
  rate: number
}

interface Actions {
  toggle(): void
  seek(seconds: number): void
  setRate(rate: number): void
}

export interface Transport extends Actions {
  get(): TransportState
  subscribe(listener: () => void): () => void
  /** The player's side: its actions, until it unmounts. */
  attach(actions: Actions): () => void
  report(state: Partial<TransportState>): void
}

export function createTransport(): Transport {
  let state: TransportState = { playing: false, duration: 0, rate: 1 }
  let actions: Actions | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    attach(a) {
      actions = a
      return () => {
        if (actions === a) actions = null
      }
    },
    report(next) {
      if (Object.entries(next).every(([k, v]) => state[k as keyof TransportState] === v)) return
      state = { ...state, ...next }
      for (const l of listeners) l()
    },
    toggle: () => actions?.toggle(),
    seek: (s) => actions?.seek(s),
    setRate: (r) => actions?.setRate(r)
  }
}

/**
 * The playback speeds (spec section 7). Slower than 1x is for reading the captions and checking a cut; the browser
 * keeps the voice's pitch at every speed (Player.tsx sets preservesPitch).
 */
export const RATES = [0.5, 1, 1.5, 2] as const

/** The next speed up (`dir` 1) or down (-1), stopping at the ends rather than wrapping round. */
export function stepRate(rate: number, dir: 1 | -1): number {
  const at = RATES.findIndex((r) => r === rate)
  const i = at < 0 ? RATES.indexOf(1) : at
  return RATES[Math.min(RATES.length - 1, Math.max(0, i + dir))]
}

/** A speed read back from storage, or 1x when it is missing or not one we offer. */
export function savedRate(stored: string | null): number {
  const r = Number(stored)
  return RATES.find((x) => x === r) ?? 1
}

export const rateLabel = (rate: number): string => `${rate}×`

export function useTransport(t: Transport): TransportState {
  return useSyncExternalStore(t.subscribe, t.get)
}
