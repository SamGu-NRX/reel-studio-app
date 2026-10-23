import { useCallback, useMemo, useRef, useState } from 'react'
import type { PlacedWord } from '../../../shared/api'
import { clock } from '../../../shared/progress'
import { momentLabel } from '../../../shared/moments'
import { Icon } from './icons'
import { useFollowPlayhead, type Playhead } from './playhead'
import type { Transport } from './transport'

/** A version's note on the timeline (✓, plays that version), or a note still waiting or being made (yellow). */
export interface TimelineMark {
  id: string
  at: number
  /** the version it made; absent while it waits or runs */
  v?: number
  text: string
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
// A press that moves less than this is a seek, more is a range. 4 px is the prototype's number.
const DRAG_PX = 4
// Shorter ranges are a click that wobbled.
const MIN_RANGE_S = 0.6

/**
 * The timeline under the video, as wide as the stage: a tick where each phrase starts, the notes that made versions,
 * the notes still waiting. Click to seek, drag the head to scrub, drag anywhere else for a range (the composer gets it).
 * The arrows step a second; with Shift they stretch a range from the playhead.
 */
export function Timeline({
  playhead,
  transport,
  duration,
  words,
  marks,
  onRange,
  onPlay
}: {
  playhead: Playhead
  transport: Transport
  duration: number
  words: PlacedWord[]
  marks: TimelineMark[]
  onRange: (r: { at: number; to: number }) => void
  onPlay: (v: number) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const head = useRef<HTMLSpanElement>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const [lit, setLit] = useState<string | null>(null)
  const keyRange = useRef<{ at: number; to: number } | null>(null)

  const follow = useCallback(
    (t: number) => {
      const f = duration ? clamp(t / duration, 0, 1) : 0
      fill.current?.style.setProperty('transform', `scaleX(${f})`)
      if (head.current) head.current.style.transform = `translateX(${f * 100}%)`
      track.current?.setAttribute('aria-valuenow', String(Math.round(t)))
      track.current?.setAttribute('aria-valuetext', clock(t))
    },
    [duration]
  )
  useFollowPlayhead(playhead, follow)

  // one tick per phrase: a word after a pause of 0.4 s or more
  const ticks = useMemo(() => {
    if (!duration) return ''
    let d = ''
    let prev = -Infinity
    for (const w of words) {
      if (w.s - prev >= 0.4 && w.s <= duration) d += `M${((w.s / duration) * 1000).toFixed(1)} 0V6`
      prev = w.e
    }
    return d
  }, [words, duration])

  const tAt = (x: number): number => {
    const b = track.current!.getBoundingClientRect()
    return clamp(((x - b.left) / b.width) * duration, 0, duration)
  }

  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!duration || ev.button !== 0 || (ev.target as HTMLElement).closest('.tl-mark')) return
    const el = ev.currentTarget
    el.setPointerCapture(ev.pointerId)
    const t0 = tAt(ev.clientX)
    const x0 = ev.clientX
    const wasPlaying = transport.get().playing
    let mode: 'press' | 'scrub' | 'range' = (ev.target as HTMLElement).closest('.tl-head') ? 'scrub' : 'press'
    if (mode === 'scrub' && wasPlaying) transport.toggle()
    const move = (e: PointerEvent) => {
      const t = tAt(e.clientX)
      if (mode === 'press' && Math.abs(e.clientX - x0) > DRAG_PX) {
        mode = 'range'
        if (transport.get().playing) transport.toggle()
      }
      if (mode === 'scrub') transport.seek(t)
      if (mode === 'range') {
        setSel({ a: Math.min(t0, t), b: Math.max(t0, t) })
        transport.seek(t)
      }
    }
    const up = (e: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      const t = tAt(e.clientX)
      setSel(null)
      if (mode === 'press') transport.seek(t)
      if (mode === 'range') {
        const a = Math.min(t0, t)
        const b = Math.max(t0, t)
        if (b - a >= MIN_RANGE_S) onRange({ at: Math.floor(a), to: Math.ceil(b) })
      }
      if (mode === 'scrub' && wasPlaying) transport.toggle()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  const key = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
      if (e.key === 'Shift') keyRange.current = null
      return
    }
    e.preventDefault()
    const d = e.key === 'ArrowRight' ? 1 : -1
    if (!e.shiftKey) return transport.seek(clamp(playhead.get() + d, 0, duration))
    const r = keyRange.current ?? { at: Math.floor(playhead.get()), to: Math.floor(playhead.get()) }
    const to = clamp(r.to + d, 0, duration)
    keyRange.current = { at: r.at, to }
    transport.seek(to)
    if (to > r.at) onRange({ at: r.at, to })
  }

  const pct = (t: number): string => `${(clamp(t, 0, duration) / (duration || 1)) * 100}%`
  return (
    <div
      ref={track}
      className="tl"
      role="slider"
      tabIndex={0}
      aria-label="Time in your reel. Drag to mark a range; Shift and the arrow keys do the same."
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      onPointerDown={down}
      onKeyDown={key}
      data-testid="timeline"
    >
      <svg className="tl-ticks" viewBox="0 0 1000 6" preserveAspectRatio="none" aria-hidden>
        <path d={ticks} />
      </svg>
      <span className="tl-rail" aria-hidden />
      <span className="tl-fill" ref={fill} aria-hidden />
      {sel && (
        <>
          <span className="tl-sel" style={{ left: pct(sel.a), width: `calc(${pct(sel.b)} - ${pct(sel.a)})` }} aria-hidden />
          <span className="tl-tip dark" style={{ left: pct(sel.b) }} aria-hidden>
            {momentLabel({ at: Math.floor(sel.a), to: Math.ceil(sel.b) })}
          </span>
        </>
      )}
      {duration > 0 &&
        marks.map((m) => (
          <button
            key={m.id}
            className={`tl-mark${m.v ? ' made' : ' waiting'}${lit === m.id ? ' lit' : ''}`}
            style={{ left: pct(m.at) }}
            tabIndex={m.v ? 0 : -1}
            aria-label={m.v ? `Play Version ${m.v}: ${m.text}` : `Waiting, ${clock(m.at)}: ${m.text}`}
            onPointerEnter={() => setLit(m.id)}
            onPointerLeave={() => setLit(null)}
            onFocus={() => setLit(m.id)}
            onBlur={() => setLit(null)}
            onClick={() => (m.v ? onPlay(m.v) : transport.seek(m.at))}
            data-testid="timeline-mark"
          >
            {m.v ? <Icon name="check" size={9} stroke={3} /> : null}
            {lit === m.id && (
              <span className={`tl-tip${m.at / duration < 0.2 ? ' start' : m.at / duration > 0.8 ? ' end' : ''}`}>
                {m.v ? <b>Version {m.v}</b> : <b>Waiting</b>}
                <span>{m.text}</span>
              </span>
            )}
          </button>
        ))}
      <span className="tl-head" ref={head} aria-hidden>
        <i />
      </span>
    </div>
  )
}
