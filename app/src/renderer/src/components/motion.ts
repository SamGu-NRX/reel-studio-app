// How the app moves: what was opened by the keyboard does not animate, and a closing layer fades
// out before it unmounts. CSS reads the `kb` class on <html> (styles: `html.kb ...`).
import { useEffect, useRef, useState } from 'react'

/** Keys that move focus or act on it. Shortcuts with Cmd/Ctrl do not count: they are not "using the keyboard to navigate". */
const NAV_KEY = /^(Tab|Enter|Escape|Arrow|Home|End|PageUp|PageDown| )/

/** Mount once (App): marks <html> as `kb` while the person drives the app from the keyboard. */
export function useInputMode(): void {
  useEffect(() => {
    const root = document.documentElement
    const down = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && (e.key.length === 1 || NAV_KEY.test(e.key))) root.classList.add('kb')
    }
    const pointer = () => root.classList.remove('kb')
    window.addEventListener('keydown', down, true)
    window.addEventListener('pointerdown', pointer, true)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('pointerdown', pointer, true)
    }
  }, [])
}

export const byKeyboard = (): boolean => document.documentElement.classList.contains('kb')
export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Keeps a layer mounted while it fades out. `leaving` is true for `exitMs` after `open` turns false;
 * opened or closed from the keyboard, it goes at once.
 */
export function usePresence(open: boolean, exitMs = 140): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(timer.current)
    if (open) {
      setMounted(true)
      setLeaving(false)
      return
    }
    if (!mounted) return
    if (byKeyboard() || reducedMotion()) {
      setMounted(false)
      setLeaving(false)
      return
    }
    setLeaving(true)
    timer.current = window.setTimeout(() => {
      setMounted(false)
      setLeaving(false)
    }, exitMs)
    return () => window.clearTimeout(timer.current)
    // `mounted` is read, not followed: only `open` starts or ends a layer
  }, [open, exitMs])
  return { mounted, leaving }
}
