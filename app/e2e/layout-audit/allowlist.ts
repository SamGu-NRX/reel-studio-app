// Accepted layout-audit findings. Each entry names the states it applies to, the element (a CSS selector matched
// with closest(), so it covers the element and what is inside it), the detector, and why it is not a bug. No entry
// may cover a whole screen: name the exact element.
import type { Detector } from './detect'

export interface Allow {
  states: string[]
  detector: Detector
  selector: string
  /** For pairwise findings (overlap, collision, nested scroll): the other element. */
  with?: string
  reason: string
}

export const ALLOW: Allow[] = [
  {
    states: ['reel-notes-timeline', 'reel-moment-chip', 'reel-speed-menu', 'reel-shape-menu', 'reel-compare', 'reel-full-stage', 'share-open', 'share-try-two', 'more-reels'],
    detector: 'overlap',
    selector: '[data-testid="timeline-mark"]',
    with: '[data-testid="timeline"]',
    reason:
      "A note's mark sits on the rail at its moment, as chapter marks do (Timeline.tsx). It is a button, so it can't be inside the track's role=slider; it is layered over it. A click on it plays its version, and the track seeks everywhere beside it and from the keyboard."
  }
]
