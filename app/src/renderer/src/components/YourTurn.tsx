import { useLayoutEffect, useRef, useState } from 'react'
import { reel } from '../api'
import { useNotify } from '../App'
import type { Go } from '../nav'
import { createFromFiles } from '../screens/create'
import { useModelStatus } from './connect'
import { fly, sampleUpgraded, takeSampleFlight } from './first-run/handoff'
import { EDITS } from './first-run/sample'
import { Icon } from './icons'
import { PickFiles } from './ui'
import coverUrl from '../assets/sample/cover.jpg'
import simpleUrl from '../assets/sample/simple.mp4'
import aiUrl from '../assets/sample/ai.mp4'

/**
 * Home before the first video, right after the first run: a drop zone that says what to bring, and the sample
 * the person just watched being edited, which they can play again. The phone from the first run lands here.
 */
export function YourTurn({ go }: { go: Go }) {
  const notify = useNotify()
  const upgraded = sampleUpgraded()
  const edit = EDITS[upgraded ? 'ai' : 'simple']
  const im = useRef<HTMLButtonElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const { s: model } = useModelStatus()

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

  let note: React.ReactNode = null
  if (model?.installed) note = 'Listening model ready.'
  else if (model?.downloading || model?.checking)
    note = `The listening model is still downloading${model.total > 0 ? ` (${Math.round(model.bytes / 1e6)} of ${Math.round(model.total / 1e6)} MB)` : ''}. I can start on a video once it’s done.`
  else if (model)
    note = (
      <>
        I need the listening model before I can start.{' '}
        <button className="link inline" onClick={() => void reel.model.download().catch(() => undefined)}>
          Download it
        </button>
      </>
    )

  return (
    <div className="yourturn">
      <div className="drop yt-drop" data-testid="your-turn">
        <span className="yt-ic" aria-hidden>
          <Icon name="upload" size={18} />
        </span>
        <h2>Your turn. Drop in a video of you talking.</h2>
        <p>Retakes and fumbles are fine. I’ll cut it the way you just watched.</p>
        <PickFiles label="Choose video" accept="video/*" className="btn primary big" onFiles={(paths) => void createFromFiles(paths, go, notify)} />
        {note && (
          <p className="yt-note" data-testid="your-turn-model">
            {note}
          </p>
        )}
      </div>
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
    </div>
  )
}
