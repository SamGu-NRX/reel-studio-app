import { useRef, useState } from 'react'
import { sampleUpgraded } from './first-run/handoff'
import { EDITS } from './first-run/sample'
import { Icon } from './icons'
import coverUrl from '../assets/sample/cover.jpg'
import simpleUrl from '../assets/sample/simple.mp4'
import aiUrl from '../assets/sample/ai.mp4'

/**
 * The sample reel on an empty Reels screen, to play again: the edit the person watched during the first run (the
 * editor's version if they connected one).
 */
export function SampleReel() {
  const upgraded = sampleUpgraded()
  const edit = EDITS[upgraded ? 'ai' : 'simple']
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
          src={upgraded ? aiUrl : simpleUrl}
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
        <span>{edit.len}</span>
      </figcaption>
    </figure>
  )
}
