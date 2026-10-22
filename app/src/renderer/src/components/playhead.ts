import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * Where the video is, outside React state. The player writes it every animation frame while playing.
 * What moves every frame follows it outside React (`useFollowPlayhead`); a component that renders reads
 * only what it shows (`usePlayhead(p, Math.round)` re-renders once a second). Playback then costs React
 * one commit a second, not one a frame.
 */
export interface Playhead {
  get(): number
  set(seconds: number): void
  subscribe(listener: () => void): () => void
}

export function createPlayhead(): Playhead {
  let at = 0
  const listeners = new Set<() => void>()
  return {
    get: () => at,
    set(seconds) {
      if (seconds === at) return
      at = seconds
      for (const l of listeners) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/** `pick` must return a primitive: the component re-renders only when it changes. */
export function usePlayhead<T extends string | number>(p: Playhead, pick: (seconds: number) => T): T {
  return useSyncExternalStore(p.subscribe, () => pick(p.get()))
}

/** Calls `write` with the playhead now and on every change, without rendering. `write` should be stable. */
export function useFollowPlayhead(p: Playhead, write: (seconds: number) => void): void {
  useLayoutEffect(() => {
    write(p.get())
    return p.subscribe(() => write(p.get()))
  }, [p, write])
}

/**
 * Moves the playhead with a playing video, once per frame the video presents. An animation-frame loop would set
 * it on every display refresh (120 a second on a 120 Hz screen) for a 30 fps video, and every follower would
 * restyle and repaint each time. `get` is read on every frame, so a video swapped for another is followed.
 * Returns a stop function.
 */
export function followVideo(get: () => HTMLVideoElement | null, p: Playhead): () => void {
  let stopped = false
  let raf = 0
  const frame = (): void => {
    if (stopped) return
    const v = get()
    if (v) p.set(v.currentTime)
    if (v && 'requestVideoFrameCallback' in v) v.requestVideoFrameCallback(frame)
    else raf = requestAnimationFrame(frame)
  }
  frame()
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}
