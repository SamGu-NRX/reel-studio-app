import { useRef } from 'react'
import { Icon } from './icons'
import { usePresence } from './motion'
import './intake.css'

// the same list as main/library.ts VIDEO_EXT
export const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts)$/i
const PICTURE_EXT = /\.(jpe?g|png|heic|heif|gif|webp|tiff?)$/i
const fileName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** "a picture", "a PDF file": what a dropped thing is, when it is not a video. */
export function whatItIs(path: string): string {
  if (PICTURE_EXT.test(path)) return 'a picture'
  const ext = /\.([a-z0-9]{1,4})$/i.exec(path)?.[1]
  return ext ? `a ${ext.toUpperCase()} file` : 'not a video'
}

export type Veil =
  /** a file is being dragged over the window */
  | { kind: 'over'; label: string; sub: string }
  /** a video arrived; the reel starts in a moment */
  | { kind: 'ok'; name: string; how: 'drop' | 'paste' }
  /** `detail`: what Reel Studio did with it, in its own words (a picture goes into the Library) */
  | { kind: 'bad'; what: string; detail: string }

/** How long the check and the file name stay before Working takes over. Keyboard and reduced motion: shorter. */
export const HANDOFF_MS = 650
export const HANDOFF_QUICK_MS = 250

/**
 * The whole window answers a dragged file before it is let go, says so when it is not a video, and on a
 * drop or paste turns into a check with the file name, then fades as the reel starts.
 */
export function DropVeil({ veil }: { veil: Veil | null }) {
  const { mounted, leaving } = usePresence(!!veil, 150)
  // what it said stays while it fades out
  const kept = useRef(veil)
  if (veil) kept.current = veil
  const last = kept.current
  if (!mounted) return null
  return (
    <div className={`dropveil${leaving ? ' leave' : ''}`} aria-hidden={veil?.kind === 'over' || undefined} data-testid="drop-overlay">
      {last?.kind === 'over' && (
        <div className="target">
          <span className="ic">
            <Icon name="video" size={22} />
          </span>
          <h2>{last.label}</h2>
          <p>{last.sub}</p>
        </div>
      )}
      {last?.kind === 'ok' && (
        <div className="target ok" role="status">
          <span className="ic done">
            <Icon name="check" size={22} stroke={2.2} />
          </span>
          <h2 data-testid="intake-name">{fileName(last.name)}</h2>
          <p>{last.how === 'paste' ? 'Pasted.' : 'Got it.'} Making your reel.</p>
        </div>
      )}
      {last?.kind === 'bad' && (
        <div className="target bad" role="alert">
          <span className="ic">
            <Icon name="alert" size={22} />
          </span>
          <h2>That’s {last.what}, not a video</h2>
          <p>{last.detail}</p>
        </div>
      )}
    </div>
  )
}
