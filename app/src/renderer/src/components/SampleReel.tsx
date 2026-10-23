import { useRef, useState } from 'react'
import { EDIT } from './first-run/sample'
import { Icon } from './icons'
import coverUrl from '../assets/sample/cover.jpg'
import aiUrl from '../assets/sample/ai.mp4'

/** The sample reel on an empty Reels screen, to play again: the Version 1 the person watched being made in the first run. */
export function SampleReel() {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const v = video.current
    if (!v) return
    if (playing) {
      v.pause()
      setPlaying(false)
    } else {
      v.currentTime = v.ended ? 0 : v.currentTime
      void v.play().then(
        () => setPlaying(true),
        () => setPlaying(false)
      )
    }
  }

  return (
    <figure className="sample-card">
      <button className="im" onClick={toggle} aria-label={playing ? 'Pause the sample reel' : 'Play the sample reel'} data-testid="sample-card">
        <video
          ref={video}
          src={aiUrl}
          poster={coverUrl}
          muted
          playsInline
          preload="metadata"
          className={playing ? 'on' : undefined}
          onEnded={() => setPlaying(false)}
        />
        <img src={coverUrl} alt="" className={playing ? 'off' : undefined} />
        <span className={`cover-t${playing ? ' off' : ''}`} aria-hidden>
          You don’t need a <em>mixer</em>
        </span>
        <span className="yt-play" aria-hidden>
          <Icon name={playing ? 'pause' : 'play'} size={14} />
        </span>
      </button>
      <figcaption>
        <b>Sample</b>
        <span>{EDIT.len}</span>
      </figcaption>
    </figure>
  )
}
