import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlacedWord } from '../../../shared/api'
import { clock } from '../../../shared/progress'
import { momentLabel } from '../../../shared/moments'
import { leadIn } from '../../../shared/sfx'
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

/** What Edit it myself adds to the timeline while it is open (ShowMeHow.tsx). Times are on the version's clock. */
export interface TimelineAudio {
  /** each sound effect at its hit, by its moment key, with its name and why it plays there */
  sounds: { key: string; at: number; label: string }[]
  /** the song's fade-in and fade-out in seconds, or null with no song */
  music: { fadeIn: number; fadeOut: number } | null
  /** where one kept span meets the next: the voice blends there */
  joins: number[]
}

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v))
// A press that moves less than this is a seek, more is a range. 4 px is the prototype's number.
const DRAG_PX = 4
// Shorter ranges are a click that wobbled.
const MIN_RANGE_S = 0.6
// Each mark is a 24 px target (WCAG 2.5.8); marks closer than that share one.
const MARK_PX = 24

/**
 * The timeline under the video, as wide as the stage: a tick where each phrase starts, the notes that made versions,
 * the notes still waiting. Click to seek, drag the head to scrub, drag anywhere else for a range (the composer gets it).
 * The arrows step a second; with Shift they stretch a range from the playhead.
 *
 * The marks sit beside the slider, not in it: a slider's children are presentational, so a screen reader never
 * reached marks inside it. Each is its own button in the tab order, named by what it is.
 */
export function Timeline({
  playhead,
  transport,
  duration,
  words,
  marks,
  onRange,
  onPlay,
  audio = null,
  selectedSound = null,
  onSound
}: {
  playhead: Playhead
  transport: Transport
  duration: number
  words: PlacedWord[]
  marks: TimelineMark[]
  onRange: (r: { at: number; to: number }) => void
  onPlay: (v: number) => void
  audio?: TimelineAudio | null
  selectedSound?: string | null
  onSound?: (key: string) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
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
    if (!duration || ev.button !== 0 || (ev.target as HTMLElement).closest('.tl-mark, .tl-sound')) return
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
    const stop = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', cancel)
    }
    const cancel = () => {
      stop()
      setSel(null)
      if (mode === 'scrub' && wasPlaying) transport.toggle()
    }
    const up = (e: PointerEvent) => {
      stop()
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
    el.addEventListener('pointercancel', cancel)
  }

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      return transport.seek(e.key === 'Home' ? 0 : duration)
    }
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    if (!d) {
      if (e.key === 'Shift') keyRange.current = null
      return
    }
    e.preventDefault()
    if (!e.shiftKey) return transport.seek(clamp(playhead.get() + d, 0, duration))
    // the range grows either way from where Shift was first held with an arrow
    const r = keyRange.current ?? { at: Math.floor(playhead.get()), to: Math.floor(playhead.get()) }
    const to = clamp(r.to + d, 0, duration)
    keyRange.current = { at: r.at, to }
    transport.seek(to)
    if (to !== r.at) onRange({ at: Math.min(r.at, to), to: Math.max(r.at, to) })
  }

  const pct = (t: number): string => `${(clamp(t, 0, duration) / (duration || 1)) * 100}%`
  const groups = markGroups(marks, duration, width)
  const sounds = audio ? markGroups(audio.sounds, duration, width) : []
  const tipSide = (at: number): string => (at / duration < 0.2 ? ' start' : at / duration > 0.8 ? ' end' : '')
  // the song's level under the rail: up over its fade-in, down over its fade-out (the two never overlap)
  const ramp = (() => {
    if (!audio?.music || !duration) return ''
    const fi = Math.min(audio.music.fadeIn / duration, 0.5) * 1000
    const fo = Math.min(audio.music.fadeOut / duration, 0.5) * 1000
    return `M0 6L${fi.toFixed(1)} 0H${(1000 - fo).toFixed(1)}L1000 6Z`
  })()
  return (
    <div className="tl" onPointerDown={down}>
      <div
        ref={track}
        className="tl-track"
        role="slider"
        tabIndex={0}
        aria-label="Time in your reel. Drag to mark a range; Shift and the arrow keys do the same."
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        onKeyDown={key}
        data-testid="timeline"
      >
        <svg className="tl-ticks" viewBox="0 0 1000 6" preserveAspectRatio="none" aria-hidden>
          <path d={ticks} />
        </svg>
        <span className="tl-rail" aria-hidden />
        <span className="tl-fill" ref={fill} aria-hidden />
        {ramp && (
          <svg className="tl-music" viewBox="0 0 1000 6" preserveAspectRatio="none" aria-hidden data-testid="timeline-music">
            <path d={ramp} />
          </svg>
        )}
        {duration > 0 && audio?.joins.map((t) => <span key={t} className="tl-join" style={{ left: pct(t) }} aria-hidden data-testid="timeline-join" />)}
        {sel && (
          <>
            <span className="tl-sel" style={{ left: pct(sel.a), width: `calc(${pct(sel.b)} - ${pct(sel.a)})` }} aria-hidden />
            <span className="tl-tip dark" style={{ left: pct(sel.b) }} aria-hidden>
              {momentLabel({ at: Math.floor(sel.a), to: Math.ceil(sel.b) })}
            </span>
          </>
        )}
        <span className="tl-heads" aria-hidden>
          <span className="tl-head" ref={head}>
            <i />
          </span>
        </span>
      </div>
      {duration > 0 && groups.length > 0 && (
        <div className="tl-marks" role="group" aria-label="Notes on the timeline">
          {groups.map(({ at, items }) => {
            const id = items[0].id
            const v = Math.max(0, ...items.map((m) => m.v ?? 0))
            return (
              <button
                key={id}
                className={`tl-mark${v ? ' made' : ' waiting'}`}
                style={{ left: pct(at) }}
                aria-label={markLabel(items)}
                onPointerEnter={() => setLit(id)}
                onPointerLeave={() => setLit(null)}
                onFocus={() => setLit(id)}
                onBlur={() => setLit(null)}
                onClick={() => (v ? onPlay(v) : transport.seek(at))}
                data-testid="timeline-mark"
              >
                {v ? <Icon name="check" size={9} stroke={3} /> : null}
                {items.length > 1 && <span className="n">{items.length}</span>}
                {lit === id && (
                  <span className={`tl-tip${tipSide(at)}`}>
                    {items.map((m) => (
                      <span key={m.id}>
                        <b>{m.v ? `Version ${m.v}` : 'Waiting'}</b> {m.text}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {duration > 0 && sounds.length > 0 && (
        <div className="tl-marks" role="group" aria-label="Sound effects on the timeline">
          {sounds.map(({ at, items }) => {
            const key = items[0].key
            const on = items.some((m) => m.key === selectedSound)
            return (
              <button
                key={key}
                className={`tl-sound${on ? ' on' : ''}`}
                style={{ left: pct(at) }}
                aria-label={items.map((m) => m.label).join('; ')}
                aria-pressed={on}
                onPointerEnter={() => setLit(key)}
                onPointerLeave={() => setLit(null)}
                onFocus={() => setLit(key)}
                onBlur={() => setLit(null)}
                onClick={() => {
                  onSound?.(on ? selectedSound! : key)
                  transport.seek(leadIn(at))
                }}
                data-testid="timeline-sound"
              >
                {lit === key && (
                  <span className={`tl-tip${tipSide(at)}`}>
                    {items.map((m) => {
                      const [what, why] = m.label.split(' · ')
                      return (
                        <span key={m.key}>
                          <b>{what}</b> {why}
                        </span>
                      )
                    })}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Marks closer than one target's width share it; the target plays the newest version among them. */
export function markGroups<T extends { at: number }>(marks: T[], duration: number, width: number): { at: number; items: T[] }[] {
  const groups: { at: number; items: T[] }[] = []
  for (const m of [...marks].sort((a, b) => a.at - b.at)) {
    const last = groups[groups.length - 1]
    if (last && duration && width && ((m.at - last.at) / duration) * width < MARK_PX) last.items.push(m)
    else groups.push({ at: m.at, items: [m] })
  }
  return groups
}

/** What a screen reader hears on a mark: what each note there made, or that it waits, and when. */
export function markLabel(items: TimelineMark[]): string {
  return items.map((m) => (m.v ? `Version ${m.v}, at ${clock(m.at)}: ${m.text}` : `Waiting, at ${clock(m.at)}: ${m.text}`)).join('; ')
}
