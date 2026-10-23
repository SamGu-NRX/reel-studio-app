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
  nextRate(): void
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
    nextRate: () => actions?.nextRate()
  }
}

export function useTransport(t: Transport): TransportState {
  return useSyncExternalStore(t.subscribe, t.get)
}
