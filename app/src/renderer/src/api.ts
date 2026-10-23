import type { MediaRef, ReelApi, UserError } from '../../shared/api'
import { MEDIA_SCHEME } from '../../shared/media-ref'
import { createBrowserReel, localOnlyError, type BrowserReel } from './browser-reel'

// The desktop app's preload sets window.reel. Without it this page was opened in a browser, from the server inside
// the desktop app (main/server), and talks to it over a WebSocket.
const preloaded = (window as { reel?: ReelApi }).reel
/** The browser connection, or null in the desktop window. */
export const browserLink: BrowserReel | null = preloaded ? null : createBrowserReel()
export const reel: ReelApi = preloaded ?? browserLink!.api

/** False in a browser: file pickers, Finder, drag-out and settings belong to the desktop app. */
export const LOCAL = reel.host === 'desktop'

/** In a browser, says that `what` works in the desktop app (a notice that stays until closed); on the desktop, runs it. */
export function onDesktop(what: string, run: () => void, notify: (text: string, kind?: 'error' | 'info' | 'notice') => void): () => void {
  return () => (LOCAL ? run() : notify(localOnlyError(what).userMessage, 'notice'))
}

/**
 * In a browser: runs `cb` each time the link to the computer comes back after a drop, so a screen can read its data
 * again (events sent while the link was down are gone). The screen stays mounted: a half-written note, focus and the
 * player keep their state. On the desktop it never fires.
 */
export function onReconnect(cb: () => void): () => void {
  return browserLink ? browserLink.onConnection((_c, reconnected) => reconnected && cb()) : () => {}
}

/** A media ref (shared/api.ts MediaRef) as something an <img> or <video> can load. */
export function mediaSrc(ref: MediaRef): string
export function mediaSrc(ref: MediaRef | null | undefined): string | undefined
export function mediaSrc(ref: MediaRef | null | undefined): string | undefined {
  if (!ref) return undefined
  return browserLink ? `/media/${browserLink.mediaToken()}/${ref}` : `${MEDIA_SCHEME}://f/${ref}`
}

export function userMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'userMessage' in e) return String((e as UserError).userMessage)
  return 'Something went wrong. Please try again.'
}

export function errorCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as UserError).code) : null
}

/**
 * Paths of files dropped on the page (Electron gives real paths through the preload). A browser has no paths: it
 * gets one '' per file, so the call that needs them (projects.create, library.add) says it works in the desktop app.
 */
export function droppedPaths(e: { dataTransfer: DataTransfer | null }): string[] {
  const paths = Array.from(e.dataTransfer?.files ?? []).map((f) => reel.app.pathForFile(f))
  return LOCAL ? paths.filter(Boolean) : paths
}

export function niceDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
