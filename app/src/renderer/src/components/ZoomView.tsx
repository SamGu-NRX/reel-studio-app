import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clock } from '../../../shared/progress'
import { Icon } from './icons'
import { useFollowPlayhead, type Playhead } from './playhead'
import { byKeyboard } from './motion'
import './zoom.css'

const RATES = [1, 1.5, 2]
const RATE_KEY = 'rs.speed'

/** A spot on the picture someone pointed at, kept on this computer with its note. */
export interface Pin {
  n: number
  at: number
  x: number
  y: number
  text: string
}

/** "top left", "the middle"...: where on the picture, in words the AI editor reads with the note. */
export function region(x: number, y: number): string {
  const v = y < 0.34 ? 'top' : y > 0.66 ? 'bottom' : 'middle'
  const h = x < 0.34 ? ' left' : x > 0.66 ? ' right' : ''
  return v === 'middle' && !h ? 'the middle' : `${v}${h}`
}

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)
}

/**
 * The reel big, beside the notes. Press C (or Comment) and click the spot you mean: a numbered pin drops
 * there and a note opens at that moment. Pins show again when the video comes back to their moment.
 */
export function ZoomView({
  title,
  picker,
  src,
  compare,
  playhead,
  original,
  pins,
  notes,
  exportLabel,
  disabled,
  aiOn,
  onClose,
  onExport,
  onPhone,
  onDoneCompare,
  onPin
}: {
  title: string
  picker: ReactNode
  src: string | null
  /** two versions side by side, before and after */
  compare: { a: { n: number; src: string }; b: { n: number; src: string } } | null
  playhead: Playhead
  original: string | null
  pins: Pin[]
  notes: ReactNode
  exportLabel: string
  disabled: boolean
  aiOn: boolean
  onClose: (at: number) => void
  onExport: () => void
  onPhone: () => void
  onDoneCompare: () => void
  /** a note at a spot; resolves false when it could not be sent (the pop-up stays) */
  onPin: (text: string, at: number, x: number, y: number) => Promise<boolean>
}) {
  const a = useRef<HTMLVideoElement>(null)
  const b = useRef<HTMLVideoElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const zv = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(() => (RATES.includes(Number(localStorage.getItem(RATE_KEY))) ? Number(localStorage.getItem(RATE_KEY)) : 1))
  const [commenting, setCommenting] = useState(false)
  const [ring, setRing] = useState<{ x: number; y: number } | null>(null)
  const [pending, setPending] = useState<{ x: number; y: number; at: number } | null>(null)
  const [pinText, setPinText] = useState('')
  const [holding, setHolding] = useState(false)
  const [t, setT] = useState(0)
  const close = useRef<HTMLButtonElement>(null)
  const range = useRef<HTMLInputElement>(null)

  const videos = () => [a.current, b.current].filter((v): v is HTMLVideoElement => !!v)
  const toggle = useCallback(() => {
    const v = a.current
    if (!v) return
    if (v.paused) videos().forEach((x) => void x.play().catch(() => {}))
    else videos().forEach((x) => x.pause())
  }, [])
  const seek = (s: number) => {
    videos().forEach((v) => (v.currentTime = Math.max(0, Math.min(s, v.duration || s))))
    playhead.set(s)
  }

  // the inert page behind, focus on Zoom out
  useEffect(() => {
    const behind = Array.from(document.querySelectorAll<HTMLElement>('.side, .main'))
    behind.forEach((el) => (el.inert = true))
    document.documentElement.classList.add('zoomed')
    close.current?.focus({ preventScroll: true })
    const v = a.current
    if (v) v.currentTime = playhead.get()
    return () => {
      behind.forEach((el) => (el.inert = false))
      document.documentElement.classList.remove('zoomed')
    }
    // opened once at the moment on screen
  }, [])

  useEffect(() => videos().forEach((v) => (v.playbackRate = rate)), [rate, src, compare])

  // B follows A: two versions at the same moment
  useEffect(() => {
    if (!compare) return
    let frame = 0
    const tick = () => {
      const x = a.current
      const y = b.current
      if (x && y && Math.abs(x.currentTime - y.currentTime) > 0.15) y.currentTime = x.currentTime
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [compare])

  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      const v = a.current
      if (v) playhead.set(v.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, playhead])
  const follow = useCallback(
    (s: number) => {
      setT(Math.round(s * 4) / 4)
      if (range.current) {
        range.current.value = String(s)
        range.current.style.setProperty('--pct', `${dur ? (s / dur) * 100 : 0}%`)
      }
    },
    [dur]
  )
  useFollowPlayhead(playhead, follow)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (pending) setPending(null)
        else if (commenting) setCommenting(false)
        else if (compare) onDoneCompare()
        else onClose(a.current?.currentTime ?? 0)
        return
      }
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if ((e.key === 'c' || e.key === 'C') && !compare && aiOn) {
        e.preventDefault()
        startComment(!commenting)
      } else if (e.key === ' ' && !(e.target as HTMLElement).closest('button, input')) {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  })

  const startComment = (on: boolean) => {
    setCommenting(on)
    setPending(null)
    if (on) {
      a.current?.pause()
      if (byKeyboard()) {
        setRing({ x: 0.5, y: 0.4 })
        zv.current?.focus()
      }
    } else setRing(null)
  }
  const drop = (x: number, y: number) => {
    a.current?.pause()
    setCommenting(false)
    setRing(null)
    setPinText('')
    setPending({ x, y, at: a.current?.currentTime ?? playhead.get() })
  }
  const sendPin = async () => {
    if (!pending || !pinText.trim()) return
    if (await onPin(pinText.trim(), pending.at, pending.x, pending.y)) {
      setPending(null)
      zv.current?.focus()
    }
  }
  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = zv.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const nextN = (pins[pins.length - 1]?.n ?? 0) + 1
  const video = (ref: React.RefObject<HTMLVideoElement | null>, s: string, label: string, main: boolean) => (
    <video
      ref={ref}
      src={s}
      preload="auto"
      playsInline
      disablePictureInPicture
      aria-label={label}
      {...(main
        ? {
            onPlay: () => setPlaying(true),
            onPause: () => setPlaying(false),
            onEnded: () => setPlaying(false),
            onLoadedMetadata: (e: React.SyntheticEvent<HTMLVideoElement>) => {
              setDur(e.currentTarget.duration || 0)
              e.currentTarget.playbackRate = rate
            },
            onSeeked: (e: React.SyntheticEvent<HTMLVideoElement>) => playhead.set(e.currentTarget.currentTime),
            'data-testid': 'zoom-video'
          }
        : { muted: true })}
    />
  )

  const pinpop =
    pending &&
    zv.current &&
    stage.current &&
    (() => {
      const s = stage.current.getBoundingClientRect()
      const z = zv.current.getBoundingClientRect()
      const px = z.left - s.left + pending.x * z.width + 30
      const py = z.top - s.top + pending.y * z.height - 30
      return { left: Math.min(px, s.width - 336), top: Math.max(8, Math.min(py, s.height - 130)) }
    })()

  return createPortal(
    <div className="zoom" role="dialog" aria-modal aria-label="Zoomed view" data-testid="zoom">
      <div className="zbar">
        <button ref={close} className="btn small" onClick={() => onClose(a.current?.currentTime ?? 0)} data-testid="unzoom">
          <Icon name="zoom-out" size={14} /> Zoom out
        </button>
        <span className="ttl">{title}</span>
        <span className="mid">{picker}</span>
        <span className="spacer" />
        {compare && (
          <button className="btn small" onClick={onDoneCompare} data-testid="done-compare">
            <Icon name="x" size={14} /> Done comparing
          </button>
        )}
        <button className="btn small" onClick={onPhone} disabled={disabled}>
          <Icon name="send" size={14} /> Send to my phone
        </button>
        <button className="btn small primary" onClick={onExport} disabled={disabled}>
          <Icon name="export" size={14} /> {exportLabel}
        </button>
      </div>
      <div className="zbody">
        <div className="stage">
          <div className="stage-v" ref={stage}>
            {compare ? (
              <>
                <div className="cmpwrap">
                  <div className="zv">{video(a, compare.a.src, `Version ${compare.a.n}`, true)}</div>
                  <span className="cap">
                    <b>Version {compare.a.n}</b> Before
                  </span>
                </div>
                <div className="cmpwrap">
                  <div className="zv">{video(b, compare.b.src, `Version ${compare.b.n}`, false)}</div>
                  <span className="cap">
                    <b>Version {compare.b.n}</b> After
                  </span>
                </div>
              </>
            ) : (
              <div
                ref={zv}
                className={`zv${commenting ? ' commenting' : ''}${holding ? ' holding' : ''}`}
                tabIndex={commenting ? 0 : -1}
                onPointerMove={(e) => commenting && setRing(at(e))}
                onPointerLeave={() => commenting && !byKeyboard() && setRing(null)}
                onClick={(e) => {
                  if (!commenting) return toggle()
                  const p = at(e)
                  drop(p.x, p.y)
                }}
                onKeyDown={(e) => {
                  if (!commenting || !ring) return
                  const d = ({ ArrowLeft: [-0.04, 0], ArrowRight: [0.04, 0], ArrowUp: [0, -0.04], ArrowDown: [0, 0.04] } as Record<string, number[]>)[e.key]
                  if (d) {
                    e.preventDefault()
                    setRing({ x: Math.min(0.96, Math.max(0.04, ring.x + d[0])), y: Math.min(0.96, Math.max(0.04, ring.y + d[1])) })
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    drop(ring.x, ring.y)
                  }
                }}
                aria-label={commenting ? 'Point at the spot you mean. Arrow keys move, Enter drops a pin.' : undefined}
              >
                {src && video(a, src, 'Your reel', true)}
                {original && holding && (
                  <>
                    <video className="original" src={original} autoPlay muted playsInline aria-hidden />
                    <span className="phone-tag">Original (from the start)</span>
                  </>
                )}
                <div className="pins">
                  {pins.map((p) => {
                    const near = Math.abs(t - p.at) <= 1.5
                    return (
                      <span key={p.n} className={`pin${near ? '' : ' away'}${p.x > 0.55 ? ' flip' : ''}`} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} aria-hidden={!near}>
                        {p.n}
                        {near && <span className="pin-lab">{p.text}</span>}
                      </span>
                    )
                  })}
                  {pending && (
                    <span className="pin drop" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }} aria-hidden>
                      {nextN}
                    </span>
                  )}
                </div>
                {commenting && ring && (
                  <span className="ring" style={{ left: `${ring.x * 100}%`, top: `${ring.y * 100}%` }} aria-hidden>
                    <span className="rt">{clock(t)}</span>
                  </span>
                )}
              </div>
            )}
            {commenting && (
              <div className="hint" aria-live="polite">
                <Icon name="comment-plus" size={14} /> Click the spot you mean <span className="kbd">Esc</span> to stop
              </div>
            )}
            {pending && pinpop && (
              <div className="pinpop" role="dialog" aria-label={`Note at ${clock(pending.at)}`} style={pinpop} data-testid="pinpop">
                <div className="cin">
                  <div className="cfield">
                    <span className="tchip">
                      {clock(pending.at)} · {region(pending.x, pending.y)}
                      <button className="x" aria-label="Remove the pin" onClick={() => setPending(null)}>
                        <Icon name="x" size={12} stroke={2} />
                      </button>
                    </span>
                    <textarea
                      autoFocus
                      rows={1}
                      value={pinText}
                      onChange={(e) => setPinText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void sendPin()
                        }
                      }}
                      aria-label="Your note at this spot"
                      placeholder="What should change here?"
                      data-testid="pin-input"
                    />
                  </div>
                  <button
                    className={`send${pinText.trim() ? ' ready' : ''}`}
                    disabled={!pinText.trim()}
                    onClick={() => void sendPin()}
                    aria-label="Send"
                    data-testid="pin-send"
                  >
                    <Icon name="arrow-up" size={16} stroke={2} />
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="ztrans">
            <button className="pp" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-testid="zoom-play">
              <Icon name={playing ? 'pause' : 'play'} size={14} stroke={2} />
            </button>
            <span className="tc">
              {clock(t)} <span>/ {clock(dur)}</span>
            </span>
            <input
              ref={range}
              className="ztrack"
              type="range"
              min={0}
              max={dur || 1}
              step={0.01}
              defaultValue={0}
              aria-label="Time in your reel"
              onChange={(e) => seek(Number(e.target.value))}
            />
            <button
              className={`scrub-speed zs${rate !== 1 ? ' on' : ''}`}
              onClick={() => {
                const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
                localStorage.setItem(RATE_KEY, String(r))
                setRate(r)
              }}
              aria-label={`Playback speed ${rate}×`}
            >
              {rate}×
            </button>
            {!compare && aiOn && (
              <button
                className={`btn ghost small cbtn${commenting ? ' on' : ''}`}
                aria-pressed={commenting}
                onClick={() => startComment(!commenting)}
                data-testid="comment"
              >
                <Icon name="comment-plus" size={14} /> Point at something <span className="kbd">C</span>
              </button>
            )}
            {!compare && original && (
              <button
                className={`btn ghost small${holding ? ' on' : ''}`}
                onPointerDown={() => setHolding(true)}
                onPointerUp={() => setHolding(false)}
                onPointerLeave={() => setHolding(false)}
                onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setHolding(true)}
                onKeyUp={() => setHolding(false)}
                aria-label="Hold for original"
                title="Hold for original"
              >
                <Icon name="original" size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="zpanel">{notes}</div>
      </div>
    </div>,
    document.querySelector('.shell') ?? document.body
  )
}
