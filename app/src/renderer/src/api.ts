import type { MediaRef, UserError } from '../../shared/api'
import { MEDIA_SCHEME } from '../../shared/media-ref'

export const reel = window.reel

/** A media ref (shared/api.ts MediaRef) as something an <img> or <video> can load. */
export function mediaSrc(ref: MediaRef): string
export function mediaSrc(ref: MediaRef | null | undefined): string | undefined
export function mediaSrc(ref: MediaRef | null | undefined): string | undefined {
  return ref ? `${MEDIA_SCHEME}://f/${ref}` : undefined
}

export function userMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'userMessage' in e) return String((e as UserError).userMessage)
  return 'Something went wrong. Please try again.'
}

export function errorCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as UserError).code) : null
}

/** Paths of files dropped on the page (Electron gives real paths through the preload). */
export function droppedPaths(e: React.DragEvent): string[] {
  return Array.from(e.dataTransfer.files)
    .map((f) => reel.app.pathForFile(f))
    .filter(Boolean)
}

export function niceDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `Today, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}
