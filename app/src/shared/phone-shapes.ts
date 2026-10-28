// The phone shapes the Reel screen's preview can take (components/Phone.tsx), and where a 9:16 reel and
// Instagram's Reels screen land on each. Sizes are iOS logical points, the unit apps lay out in.
//
// Sources for the device numbers (first gathered on the device-previews branch, efc4c41):
// - screens: iPhone SE 375 x 667 (https://www.ios-resolution.com/iphone-se-3rd-gen/), iPhone 17 402 x 874
//   (https://useyourloaf.com/blog/iphone-17-screen-sizes/), iPhone 17 Pro Max 440 x 956
//   (https://useyourloaf.com/blog/iphone-16-screen-sizes/; the 16 and 17 Pro Max share the screen);
// - safe areas: "top 62, bottom 34" on the 17 and the Pro Max (same pages); the SE has a 20 pt status bar and no
//   Home indicator;
// - corners: 62 pt on the 17 and the Pro Max, read from the private _displayCornerRadius
//   (https://github.com/kylebshr/ScreenCorners), a measurement rather than an Apple spec; the SE's screen is square.
//
// What is an estimate: Meta publishes no layout for Reels. Instagram's own sizes (the tab bar, header, rail and
// name block, the `IG` numbers below) are the ones Phone.css draws, estimated from the iOS app. Whether Instagram
// fills a taller screen and trims the sides, or letterboxes, is not documented either: this assumes it fills the
// area above its tab bar, as the app is commonly seen, so every fit is worded "about" and "may".
import { MARGIN_FRAC } from './caption-fit'

export type ShapeId = 'reel' | 'iphone-se' | 'iphone-17' | 'iphone-pro-max'

export interface Shape {
  id: ShapeId
  /** What the picker says. */
  label: string
  /** The screen's proportion, width first (9:16), as the menu shows it. */
  ratio: string
  /** The screen in points. */
  w: number
  h: number
  /** Display corner radius, in points. */
  radius: number
  /** Status bar (and Dynamic Island) height: Instagram's header starts under it. Neither is drawn (ux-foundation-b 3.2). */
  top: number
  /** The Home indicator's strip under Instagram's tab bar. */
  home: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Instagram's Reels screen in points (Phone.css draws it from the same numbers): the header's height, the tab bar's,
 * the rail's width and inset, the gap above the tab bar, and the name, caption and audio block's height with a
 * caption line (32 avatar + 10 + 17 caption + 10 + 16 audio).
 */
export const IG = { header: 50, tabBar: 50, railW: 48, railRight: 8, gap: 14, metaH: 85, metaLeft: 14 }

/** The edges the engine's own check keeps captions inside (engine/reelengine/verify.py IG_*_FRAC), as fractions of the reel. */
export const ENGINE_BAND = { top: 0.07, bottom: 0.19, right: 0.13, left: MARGIN_FRAC }

// The plain frame is the reel itself, drawn at the 393 pt width Instagram's screen is measured in (Phone.css).
const REEL_W = 393

export const SHAPES: readonly Shape[] = [
  { id: 'reel', label: 'Whole reel', ratio: '9:16', w: REEL_W, h: (REEL_W * 16) / 9, radius: 25.5, top: 0, home: 0 },
  { id: 'iphone-se', label: 'iPhone SE', ratio: '9:16', w: 375, h: 667, radius: 0, top: 20, home: 0 },
  { id: 'iphone-17', label: 'iPhone 17', ratio: '9:19.5', w: 402, h: 874, radius: 62, top: 62, home: 34 },
  { id: 'iphone-pro-max', label: 'iPhone 17 Pro Max', ratio: '9:19.5', w: 440, h: 956, radius: 62, top: 62, home: 34 }
]

export const DEFAULT_SHAPE: ShapeId = 'reel'

export function shapeById(id: string | null | undefined): Shape {
  return SHAPES.find((s) => s.id === id) ?? SHAPES[0]
}

export interface Placement {
  /** Where Instagram shows the reel: the whole frame, or a phone's screen above its tab bar. */
  viewer: Rect
  /** The reel, scaled to cover the viewer; it overhangs the viewer where Instagram trims it. */
  reel: Rect
  /** What part of the reel is cut off, each side, as a fraction of its width or height. */
  trim: { sides: number; ends: number }
}

/** Where the reel sits on `s`. The whole reel is its own frame, with Instagram's tab bar drawn over its foot. */
export function place(s: Shape): Placement {
  const viewer: Rect = s.id === 'reel' ? { x: 0, y: 0, w: s.w, h: s.h } : { x: 0, y: 0, w: s.w, h: s.h - IG.tabBar - s.home }
  const k = Math.max(viewer.w / 9, viewer.h / 16)
  const reel: Rect = { x: (viewer.w - 9 * k) / 2, y: viewer.y + (viewer.h - 16 * k) / 2, w: 9 * k, h: 16 * k }
  return { viewer, reel, trim: { sides: Math.max(0, -reel.x) / reel.w, ends: Math.max(0, viewer.y - reel.y) / reel.h } }
}

/** Instagram's own parts on `s`, in screen points: header, rail, name block and tab bar. */
export function chrome(s: Shape): Record<'header' | 'rail' | 'meta' | 'tabs', Rect> {
  const tabsTop = s.h - IG.tabBar - s.home
  const foot = tabsTop - IG.gap
  return {
    header: { x: 0, y: s.top, w: s.w, h: IG.header },
    // the rail's height is not needed: it runs from the foot up past where captions sit
    rail: { x: s.w - IG.railRight - IG.railW, y: 0, w: IG.railW, h: foot },
    meta: { x: IG.metaLeft, y: foot - IG.metaH, w: s.w - IG.metaLeft - (IG.railRight + IG.railW + 16), h: IG.metaH },
    tabs: { x: 0, y: tabsTop, w: s.w, h: IG.tabBar + s.home }
  }
}

/**
 * Where captions stay clear of Instagram on `s`, in screen points (the #59 safe band). On the whole reel it is the
 * engine's own band. On a phone it is what that phone leaves: under the header, above the name block, left of the
 * rail, inside the part of the reel Instagram shows, and no nearer the left edge than the engine's subtitle margin.
 */
export function clearBand(s: Shape): Rect {
  const { viewer, reel } = place(s)
  const fromReel = {
    left: reel.x + ENGINE_BAND.left * reel.w,
    right: reel.x + reel.w * (1 - ENGINE_BAND.right),
    top: reel.y + ENGINE_BAND.top * reel.h,
    bottom: reel.y + reel.h * (1 - ENGINE_BAND.bottom)
  }
  if (s.id === 'reel') return { x: fromReel.left, y: fromReel.top, w: fromReel.right - fromReel.left, h: fromReel.bottom - fromReel.top }
  const c = chrome(s)
  const left = Math.max(viewer.x, fromReel.left)
  const right = Math.min(c.rail.x, viewer.x + viewer.w)
  const top = Math.max(viewer.y, c.header.y + c.header.h)
  const bottom = Math.min(c.meta.y, viewer.y + viewer.h)
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** The fit in plain words: what Instagram may trim on this phone. */
export function fitWords(s: Shape): string {
  if (s.id === 'reel') return 'The whole reel, as it exports.'
  const { trim } = place(s)
  const pct = (f: number): number => Math.round(f * 100)
  if (trim.sides > 0.005) return `Instagram may trim about ${pct(trim.sides)}% off each side.`
  if (trim.ends > 0.005) return `Instagram may trim about ${pct(trim.ends)}% off the top and bottom.`
  return 'Your reel should fill this screen.'
}
