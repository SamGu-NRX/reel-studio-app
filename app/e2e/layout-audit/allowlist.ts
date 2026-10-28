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

export const ALLOW: Allow[] = []
