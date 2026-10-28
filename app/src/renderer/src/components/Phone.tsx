// The phone preview, wherever a reel is shown: the reel at 9:16 inside a thin device edge, under Instagram's
// Reels screen ("Instagram") or alone ("Clean"). The person's choice is an app setting (main/settings.ts).
// On the Reel screen the frame can also take a real phone's shape (shared/phone-shapes.ts), remembered per person.
import { memo, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { PhoneView } from '../../../shared/api'
import { DEFAULT_SHAPE, clearBand, place, shapeById, type Shape } from '../../../shared/phone-shapes'
import { reel } from '../api'
import { Icon } from './icons'
import { Segmented } from './ui'
import './Phone.css'

let view: PhoneView = 'instagram'
let chosen = false
const listeners = new Set<() => void>()
const emit = (next: PhoneView): void => {
  view = next
  for (const l of listeners) l()
}
// Read once at start-up, long before a reel opens. A choice made before it answers wins.
void reel.app.info().then((i) => {
  if (!chosen) emit(i.phoneView)
})

/** The view and a setter that saves it. The setter's promise rejects when the setting could not be saved. */
export function usePhoneView(): [PhoneView, (next: PhoneView) => Promise<unknown>] {
  const v = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => view
  )
  return [
    v,
    (next) => {
      chosen = true
      emit(next)
      return reel.app.setPhoneView(next)
    }
  ]
}

const SHAPE_KEY = 'rs.phone-shape'
let shape: Shape = shapeById(localStorage.getItem(SHAPE_KEY) ?? DEFAULT_SHAPE)
const shapeListeners = new Set<() => void>()

/** The phone shape the preview takes, and a setter that remembers it on this computer. */
export function usePhoneShape(): [Shape, (next: Shape) => void] {
  const s = useSyncExternalStore(
    (l) => (shapeListeners.add(l), () => shapeListeners.delete(l)),
    () => shape
  )
  return [
    s,
    (next) => {
      shape = next
      localStorage.setItem(SHAPE_KEY, next.id)
      for (const l of shapeListeners) l()
    }
  ]
}

const pct = (n: number): string => `${+(n * 100).toFixed(4)}%`

/**
 * A shape as the CSS variables Phone.css and reel.css read on `.phone` and inherit below it: the screen's
 * proportion and corners, the reel's box on the screen (it overhangs where Instagram trims it), what of that box
 * shows, and Instagram's insets in points. The plain frame sets the same values the stylesheet falls back to.
 */
export function shapeVars(s: Shape): CSSProperties {
  const { viewer, reel } = place(s)
  const clip = [viewer.y - reel.y, reel.x + reel.w - viewer.x - viewer.w, reel.y + reel.h - viewer.y - viewer.h, viewer.x - reel.x]
  return {
    '--ratio': `${s.w} / ${s.h}`,
    '--ratio-n': s.w / s.h,
    '--radius': `${pct(s.radius / s.w)} / ${pct(s.radius / s.h)}`,
    '--sw': s.w,
    '--ig-top': s.top,
    '--ig-home': s.home,
    '--reel-l': pct(reel.x / s.w),
    '--reel-t': pct(reel.y / s.h),
    '--reel-w': pct(reel.w / s.w),
    '--reel-h': pct(reel.h / s.h),
    '--reel-clip': `inset(${clip.map((c, i) => pct(Math.max(0, c) / (i % 2 ? reel.w : reel.h))).join(' ')})`,
    // how far the reel's top sits above the screen's (Instagram trims it), for what is drawn from the reel's top edge
    '--reel-dip': `calc(${+Math.max(0, -reel.y).toFixed(3)} * 100cqw / ${s.w})`
  } as CSSProperties
}

/** Sizes the phone in `slot` to the slot's full height at `ratio` (width over height). */
export function fitPhone(slot: HTMLElement, ratio: number, height = slot.clientHeight): void {
  slot.style.setProperty('--phone-w', `${height * ratio}px`)
}

/**
 * Gives the phone inside it the full height it has, at its shape's proportion (9:16 unless told). Its column takes
 * its width from the phone, so the width can only come from the height; a ResizeObserver writes it, on resize only,
 * without rendering.
 */
export function PhoneFill({ children, ratio = 9 / 16 }: { children: ReactNode; ratio?: number }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = slot.current!
    fitPhone(el, ratio)
    const ro = new ResizeObserver(([e]) => fitPhone(el, ratio, e.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ratio])
  return (
    <div className="phone-fill" ref={slot}>
      {children}
    </div>
  )
}

/** A reel with no player controls (the onboarding sample, the take while the first edit starts). */
export function Phone({ view, caption, className, children, testid }: { view: PhoneView; caption?: string; className?: string; children: ReactNode; testid?: string }) {
  return (
    <PhoneFill>
      <div className={`phone${className ? ` ${className}` : ''}`} data-testid="phone">
        <div className="phone-screen" data-testid={testid} data-lands>
          {children}
          <InstagramChrome on={view === 'instagram'} caption={caption} />
        </div>
      </div>
    </PhoneFill>
  )
}

/** Instagram or Clean, under the phone. */
const PHONE_VIEWS = [
  { key: 'instagram', label: 'Instagram', title: 'Your reel under Instagram’s buttons and caption', testid: 'view-instagram' },
  { key: 'clean', label: 'Clean', title: 'Your reel alone', testid: 'view-clean' }
] as const satisfies readonly { key: PhoneView; label: string; title: string; testid: string }[]

export function PhoneViewSwitch({ value, onChange }: { value: PhoneView; onChange: (v: PhoneView) => void }) {
  return <Segmented label="Phone view" testid="phone-view" value={value} options={PHONE_VIEWS} onPick={onChange} />
}

/**
 * Where subtitles stay clear of Instagram, shown while the person sets them up. On the whole reel these are the
 * edges the engine's own check uses (engine/reelengine/verify.py IG_TOP_FRAC, IG_BOTTOM_FRAC, IG_RIGHT_FRAC) and the
 * subtitle margin on the left (shared/caption-fit.ts MARGIN_FRAC), which Phone.css also falls back to. On a phone
 * shape it is what that phone leaves clear (phone-shapes.ts clearBand), which can be smaller.
 */
export function SafeBand({ shape: s }: { shape?: Shape }) {
  const band = s && clearBand(s)
  const style = s && band ? { left: pct(band.x / s.w), top: pct(band.y / s.h), width: pct(band.w / s.w), height: pct(band.h / s.h), right: 'auto', bottom: 'auto' } : undefined
  return (
    <div className="safe-band" style={style} data-testid="safe-band" aria-hidden>
      <span>Clear of Instagram</span>
    </div>
  )
}

// Lucide geometry (ISC), like components/icons.tsx, for the parts of Instagram's screen the shared set lacks.
function G({ size, children, fill }: { size: number; children: ReactNode; fill?: boolean }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}
const camera = (
  <>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </>
)
const repost = (
  <>
    <path d="m2 9 3-3 3 3" />
    <path d="M13 18H7a2 2 0 0 1-2-2V6" />
    <path d="m22 15-3 3-3-3" />
    <path d="M11 6h6a2 2 0 0 1 2 2v10" />
  </>
)
const house = (
  <>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </>
)
const search = (
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>
)

/** Instagram's Reels icon, selected (filled), as the tab bar shows it on the Reels screen. */
function ReelsTab() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="currentColor" />
      <path d="M2.5 8.5h19M8 2.5l3 6M14 2.5l3 6" stroke="#000" strokeWidth={1.6} strokeLinecap="round" />
      <path d="M10 12.2v5.6l4.8-2.8z" fill="#000" />
    </svg>
  )
}

function CaptionLine({ text }: { text: string }) {
  const span = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const el = span.current!
    const ro = new ResizeObserver(() => setCut(el.scrollWidth > el.clientWidth + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])
  return (
    <div className="igc-cap">
      <span ref={span}>{text}</span>
      {cut && <em>more</em>}
    </div>
  )
}

const HANDLE = 'yourname'
const COUNTS = ['1,204', '86', '31', '142']

/**
 * Instagram's Reels screen over the reel, in iOS points (Phone.css). Always on the page so switching views
 * fades it rather than popping it; hidden from screen readers, it is a picture of another app. `playing`
 * runs the audio ticker, as Instagram does only while the reel plays.
 */
export const InstagramChrome = memo(function InstagramChrome({ on, caption, playing }: { on: boolean; caption?: string; playing?: boolean }) {
  const text = caption?.trim()
  return (
    <div className={`igc${on ? '' : ' off'}`} data-playing={playing || undefined} data-testid="ig-overlay" aria-hidden>
      <div className="igc-top">
        <b>Reels</b>
        <Icon name="chevron-down" size={16} stroke={2.5} />
        <span className="igc-cam">
          <G size={26}>{camera}</G>
        </span>
      </div>
      <div className="igc-rail">
        <span>
          <Icon name="heart" size={27} stroke={2} />
          {COUNTS[0]}
        </span>
        <span>
          <Icon name="comment" size={27} stroke={2} />
          {COUNTS[1]}
        </span>
        <span>
          <G size={27}>{repost}</G>
          {COUNTS[2]}
        </span>
        <span>
          <Icon name="send" size={27} stroke={2} />
          {COUNTS[3]}
        </span>
        <span>
          <Icon name="more" size={24} stroke={2.5} />
        </span>
        <i className="igc-disc" />
      </div>
      <div className="igc-meta">
        <div className="igc-who">
          <i className="igc-avatar" />
          <b>{HANDLE}</b>
          <span className="igc-follow">Follow</span>
        </div>
        {text && <CaptionLine text={text} />}
        <div className="igc-audio">
          <Icon name="music" size={12} stroke={2.5} />
          <div className="igc-tick">
            <div>
              <span>{HANDLE} · Original audio</span>
              <span>{HANDLE} · Original audio</span>
            </div>
          </div>
        </div>
      </div>
      <div className="igc-tabs">
        <G size={26}>{house}</G>
        <ReelsTab />
        <Icon name="send" size={26} stroke={2} />
        <G size={26}>{search}</G>
        <i className="igc-avatar" />
      </div>
    </div>
  )
})
