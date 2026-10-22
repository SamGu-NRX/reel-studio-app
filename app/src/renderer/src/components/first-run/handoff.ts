// The first run ends by flying the sample's phone into the sample card on Home. The two screens are different
// trees, so the phone's place is handed over here and Home takes it once.

interface Handoff {
  /** where the phone's screen was, or null for no flight (reduced motion, keyboard, a narrow window) */
  from: DOMRect | null
  /** an AI editor was connected during setup: the sample shows its edit */
  upgraded: boolean
}

let pending: Handoff | null = null
const KEY = 'rs.sample-upgraded'

export function handOffSample(h: Handoff): void {
  pending = h
  localStorage.setItem(KEY, h.upgraded ? '1' : '0')
}

/** Once: the flight's start, if the first run just ended. */
export function takeSampleFlight(): DOMRect | null {
  const f = pending?.from ?? null
  pending = null
  return f
}

export const sampleUpgraded = (): boolean => localStorage.getItem(KEY) === '1'
/** The person watched the sample during the first run, so Home can say "the way you just watched". */
export const sawSample = (): boolean => localStorage.getItem(KEY) !== null

/** The rect an image of this aspect fills when it covers `r`, centred on `r`. */
function coverBox(r: DOMRect, aspect: number): { x: number; y: number; w: number; h: number } {
  const w = r.width / r.height < aspect ? r.height * aspect : r.width
  const h = w / aspect
  return { x: r.left + (r.width - w) / 2, y: r.top + (r.height - h) / 2, w, h }
}

/**
 * One image moving between two rects that each show it cover-fitted, clipped to each one's corners. The flyer is
 * the image's whole box, so its picture keeps one scale for the whole flight; only the clip changes shape.
 * `aspect` is the image's width / height (the bundled sample stills are all 9:16).
 */
export function fly(src: string, from: DOMRect, to: DOMRect, fromRadius: number, toRadius: number, dur: number, aspect = 9 / 16): Promise<void> {
  const B = coverBox(to, aspect)
  const F = coverBox(from, aspect)
  const node = document.createElement('div')
  node.className = 'fr-flyer'
  Object.assign(node.style, { left: `${B.x}px`, top: `${B.y}px`, width: `${B.w}px`, height: `${B.h}px` })
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  node.append(img)
  document.body.append(node)
  const k = F.w / B.w
  const dx = F.x + F.w / 2 - (B.x + B.w / 2)
  const dy = F.y + F.h / 2 - (B.y + B.h / 2)
  // insets in the flyer's own pixels: at the start it is scaled by k, so the visible rect is from / k
  const clip = (r: DOMRect, scale: number, radius: number) =>
    `inset(${(B.h - r.height / scale) / 2}px ${(B.w - r.width / scale) / 2}px round ${radius / scale}px)`
  const a = node.animate(
    [
      { transform: `translate(${dx}px,${dy}px) scale(${k})`, clipPath: clip(from, k, fromRadius) },
      { transform: 'none', clipPath: clip(to, 1, toRadius) }
    ],
    { duration: dur, easing: 'cubic-bezier(.77,0,.175,1)', fill: 'forwards' }
  )
  return a.finished.then(
    () => node.remove(),
    () => node.remove()
  )
}
