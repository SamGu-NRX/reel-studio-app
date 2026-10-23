// Live previews of an edit on the reel's one player (components/Player.tsx): skipping words being cut,
// sounds being added, and the cover and pictures drawn over the phone. Nothing here mounts a second copy of
// the reel; the only other media are still frames of the original and the sounds themselves, paused until used.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { Playhead } from '../../components/playhead'

/** The reel's player, as Edit it myself drives it. */
export interface PlayerHandle {
  playhead: Playhead
  /** Moves the player to `seconds` on the version's clock, and starts it with `play`. */
  seek: (seconds: number, play?: boolean) => void
  playing: () => boolean
  /** An empty layer over the phone's screen, for drawing previews (null until it mounts). */
  stage: HTMLElement | null
}

/** Draws `children` over the phone's screen. */
export function OnPhone({ player, children }: { player: PlayerHandle; children: ReactNode }) {
  return player.stage ? createPortal(children, player.stage) : null
}

/** While the reel plays, jumps over each range (seconds on the version's clock): the words being cut. */
export function SkipRanges({ player, ranges }: { player: PlayerHandle; ranges: [number, number][] }) {
  const { playhead, seek } = player
  useEffect(() => {
    if (!ranges.length) return
    return playhead.subscribe(() => {
      const t = playhead.get()
      const r = ranges.find(([a, b]) => t >= a && t < b - 0.02)
      if (r) seek(r[1])
    })
  }, [playhead, seek, ranges])
  return null
}

/** Plays each sound as the reel passes its moment, so a sound not in this version yet is heard in place. */
export function SoundCues({ player, cues }: { player: PlayerHandle; cues: { at: number; url: string; volume: number }[] }) {
  const { playhead } = player
  useEffect(() => {
    if (!cues.length) return
    const audio = cues.map((c) => Object.assign(new Audio(c.url), { preload: 'auto', volume: c.volume }))
    let last = playhead.get()
    const off = playhead.subscribe(() => {
      const t = playhead.get()
      // a step forward the size of a frame or two is playback; a seek starts nothing
      if (t > last && t - last < 0.25) cues.forEach((c, i) => c.at >= last && c.at < t && ((audio[i].currentTime = 0), void audio[i].play().catch(() => {})))
      last = t
    })
    return () => {
      off()
      audio.forEach((a) => (a.pause(), a.removeAttribute('src'), a.load()))
    }
  }, [playhead, cues])
  return null
}

/**
 * One sound on its own, for the preview button beside each sound and song. Starting another stops this one.
 * `id` says which button is playing (default: the file), so two sounds that use the same file are told apart.
 * Playing the one already playing stops it, unless `restart` (a level just changed: hear it at the new one).
 */
export function useAudition(): {
  playing: string | null
  play: (url: string, volume?: number, opts?: { id?: string; restart?: boolean }) => void
  stop: () => void
} {
  const el = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  // each play() gets a number: a start that fails or ends after another began must not clear the newer one
  const run = useRef(0)
  const stop = () => {
    run.current++
    el.current?.pause()
    setPlaying(null)
  }
  useEffect(() => () => {
    el.current?.pause()
    el.current?.removeAttribute('src')
  }, [])
  return {
    playing,
    stop,
    play: (url, volume = 1, { id = url, restart = false } = {}) => {
      const a = (el.current ??= new Audio())
      a.pause()
      if (playing === id && !restart) return setPlaying(null)
      a.src = url
      a.volume = volume
      a.currentTime = 0
      const n = ++run.current
      const done = () => n === run.current && setPlaying(null)
      a.onended = done
      setPlaying(id)
      void a.play().catch(done)
    }
  }
}

/** Shows `children` over the phone only while the reel is between `from` and `to` (seconds), without rendering per frame. */
export function During({ player, from, to, children }: { player: PlayerHandle; from: number; to: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const show = () => box.current?.classList.toggle('on', player.playhead.get() >= from && player.playhead.get() < to)
    show()
    return player.playhead.subscribe(show)
  }, [player.playhead, from, to])
  return (
    <div ref={box} className="edit-during">
      {children}
    </div>
  )
}
