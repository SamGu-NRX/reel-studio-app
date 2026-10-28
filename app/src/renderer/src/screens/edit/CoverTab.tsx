import { useEffect, useState } from 'react'
import type { CoverCandidate, ProjectJson } from '../../../../shared/api'
import { coverMoments } from '../../../../shared/cover'
import { isMirrored, withMirror } from '../../../../shared/mirror'
import { clock } from '../../../../shared/progress'
import { CoverPicks } from '../../components/CoverPicks'
import { setP, type TabProps } from './controls'
import { OnPhone } from './preview'

type Cover = NonNullable<ProjectJson['cover']>

/** The cover tab: frames picked from the video, any moment of it, the words on the cover, and Flip the picture,
 * whose effect shows here first. The phone shows the cover as it will be while this tab is open. */
export function CoverTab({ d, base, now, change, settle, player, version, loadPicks }: TabProps & { loadPicks: () => Promise<CoverCandidate[]> }) {
  const [picks, setPicks] = useState<CoverCandidate[]>([])
  const first = d.project.sources?.[0]
  const cover: Cover = now.p.cover ?? { atSourceTime: 0, source: first?.id ?? 's1', text: null }
  const was = base.p.cover
  const at = Number(cover.atSourceTime) || 0
  const source = cover.source ?? first?.id ?? 's1'
  const duration = now.p.sources?.find((s) => s.id === source)?.duration ?? first?.duration ?? 60
  const setCover = (c: Partial<Cover>, key?: string) => change(setP((p) => ({ cover: { ...cover, ...(p.cover ?? {}), ...c } })), key)

  useEffect(() => {
    let live = true
    loadPicks().then((r) => live && setPicks(r), () => undefined)
    return () => {
      live = false
    }
  }, [loadPicks])

  const frameMoved = at !== (Number(was?.atSourceTime) || 0) || source !== (was?.source ?? source)
  const wordsChanged = (cover.text ?? null) !== (was?.text ?? null)
  const pick = picks.find((c) => Math.abs(c.atSourceTime - at) < 0.01 && c.source === source)
  const raw = d.sourceVideos[source]
  const mirrored = now.p.sources?.find((s) => s.id === source)?.mirror === true
  // the version's cover and the picked stills were made before this edit's flip: drawn flipped, they show the new one
  const flipped = mirrored !== (base.p.sources?.find((s) => s.id === source)?.mirror === true)

  return (
    <div className="edit-stack">
      <OnPhone player={player}>
        <div className="edit-cover" data-testid="cover-preview">
          {!frameMoved && !wordsChanged && !flipped && version?.cover ? (
            <img src={version.cover} alt="" />
          ) : pick ? (
            <img src={pick.image} className={flipped ? 'mirrored' : undefined} alt="" />
          ) : raw ? (
            <video key={`${raw}#${at}`} className={mirrored ? 'mirrored' : undefined} src={`${raw}#t=${at.toFixed(2)}`} muted playsInline preload="auto" disablePictureInPicture aria-hidden />
          ) : null}
          {(frameMoved || wordsChanged || flipped || !version?.cover) && cover.text && <span className="edit-cover-words">{cover.text}</span>}
          <span className="phone-tag">Cover</span>
        </div>
      </OnPhone>
      <label className="edit-field">
        <span className="edit-label">Words on the cover</span>
        <input
          className="input"
          placeholder="Leave empty for no words"
          value={cover.text ?? ''}
          maxLength={60}
          onChange={(e) => setCover({ text: e.target.value || null }, 'cover-text')}
          onBlur={settle}
          data-testid="cover-words"
        />
      </label>
      <CoverPicks
        load={loadPicks}
        waiting={coverMoments(d.words, now.kept, source).length}
        chosen={at}
        flipped={flipped}
        onPick={(c) => setCover({ atSourceTime: c.atSourceTime, source: c.source, exact: null, manual: true })}
      />
      <label className="edit-field">
        <span className="edit-label">Or pick any moment</span>
        <input
          type="range"
          className="slider"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={0.5}
          value={at}
          onChange={(e) => setCover({ atSourceTime: Number(e.target.value), source, exact: null, manual: null }, 'cover-moment')}
          onPointerUp={settle}
          onKeyUp={settle}
          data-testid="cover-slider"
        />
        <span className="edit-hint tnum">{clock(at)} into the video you filmed. The clearest frame of your face near it is used.</span>
      </label>
      <div className="edit-rule" />
      {/* a front-camera take often comes out mirrored: writing behind you reads backwards */}
      <div className="edit-field">
        <label className="toggle">
          <input type="checkbox" checked={isMirrored(now.p)} onChange={(e) => change(setP((p) => ({ sources: withMirror(p.sources, e.target.checked) })))} data-testid="mirror-on" />
          Flip the picture
        </label>
        <p className="edit-hint">For a mirrored video, when writing behind you reads backwards. Subtitles and pictures stay the right way round.</p>
      </div>
    </div>
  )
}
