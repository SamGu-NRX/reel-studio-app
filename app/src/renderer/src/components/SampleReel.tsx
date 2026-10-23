import { useLayoutEffect, useRef, useState } from 'react'
import { fly, sampleUpgraded, takeSampleFlight } from './first-run/handoff'
import { EDITS } from './first-run/sample'
import { Icon } from './icons'
import coverUrl from '../assets/sample/cover.jpg'
import simpleUrl from '../assets/sample/simple.mp4'
import aiUrl from '../assets/sample/ai.mp4'

/**
 * The sample reel on an empty Reels screen, to play again: the edit the person watched during the first run (the
 * editor's version if they connected one). The first run's phone lands here.
 */
export function SampleReel() {
  const upgraded = sampleUpgraded()
  const edit = EDITS[upgraded ? 'ai' : 'simple']
  const im = useRef<HTMLButtonElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)

  useLayoutEffect(() => {
    const from = takeSampleFlight()
    const el = im.current
    if (!from || !el) return
    el.style.visibility = 'hidden'
    void fly(coverUrl, from, el.getBoundingClientRect(), 38, 14, 620).then(() => (el.style.visibility = ''))
  }, [])

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
      <button className="im" ref={im} onClick={toggle} aria-label={playing ? 'Pause the sample reel' : 'Play the sample reel'} data-testid="sample-card">
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
