import { useEffect, useState, type KeyboardEvent } from 'react'
import type { CoverCandidate } from '../../../shared/api'
import { coverReason } from '../../../shared/cover'
import { clock } from '../../../shared/progress'
import { userMessage } from '../api'

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }

/**
 * The cover suggestions as one filmstrip, in the order they happen: the best frame of you near a few moments of
 * the video, side by side at one size so faces compare at a glance, and the chosen one full size on the phone.
 * The line under the strip says when and why for the frame pointed at, or else the chosen one. Picking one hands
 * its exact time back.
 */
export function CoverPicks({
  load,
  waiting,
  chosen,
  flipped,
  yours,
  onPick
}: {
  /** the engine's answer; the drawer keeps one per opening so switching tabs does not look again */
  load: () => Promise<CoverCandidate[]>
  /** how many frames are being looked for (the placeholders while it looks) */
  waiting: number
  /** the cover's time now, in raw-take seconds */
  chosen: number
  /** the stills were taken before Flip the picture changed: show them the way the cover will be */
  flipped: boolean
  /** when the cover is the person's own frame and none of these: its time in the version ("0:07"), else null */
  yours: string | null
  onPick: (c: CoverCandidate) => void
}) {
  const [picks, setPicks] = useState<CoverCandidate[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [pointed, setPointed] = useState<CoverCandidate | null>(null)

  useEffect(() => {
    let live = true
    load()
      .then((r) => live && setPicks(r))
      .catch((e) => {
        if (!live) return
        setProblem(userMessage(e))
        setPicks([])
      })
    return () => {
      live = false
    }
    // load hands back the drawer's one promise, so only the first call matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isChosen = (c: CoverCandidate) => Math.abs(c.atSourceTime - chosen) < 0.01

  // One Tab stop for the group; arrow keys move and pick, as in any set of radio buttons.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_STEP[e.key]
    if (!step || !picks?.length) return
    e.preventDefault()
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')]
    const i = (Math.max(0, buttons.findIndex((b) => b === document.activeElement)) + step + picks.length) % picks.length
    buttons[i].focus()
    onPick(picks[i])
  }

  const said = pointed ?? picks?.find(isChosen) ?? null
  // when and why for the frame pointed at or chosen; for the person's own frame, that it is theirs
  const why = said ? (
    <>
      <b className="tnum">{clock(said.atSourceTime)}</b> {coverReason(said.reasons)}
    </>
  ) : yours ? (
    <>
      Your pick at <b className="tnum">{yours}</b>
    </>
  ) : null
  return (
    <section className="stack" aria-labelledby="cover-picks-title">
      <div>
        <h3 id="cover-picks-title">Picked from your video</h3>
        {picks?.length !== 0 && <p className="muted-sm">The moments where your face is clearest. Pick one, or choose any moment below.</p>}
      </div>
      {picks === null ? (
        <div>
          <p className="muted-sm cover-status" role="status">
            Looking through your video
          </p>
          <div className="cover-strip" aria-busy="true" data-testid="cover-picks-loading">
            {Array.from({ length: waiting }, (_, i) => (
              <span key={i} className="cover-frame cover-frame-wait" />
            ))}
          </div>
        </div>
      ) : picks.length === 0 ? (
        <div>
          <p className="muted-sm" data-testid="cover-picks-none">
            {problem ?? 'No clear frame of your face was found. Pick any moment below.'}
          </p>
          {why && (
            <p className="cover-why" data-testid="cover-why">
              {why}
            </p>
          )}
        </div>
      ) : (
        <div>
          <div
            className={`cover-strip${flipped ? ' flipped' : ''}`}
            role="radiogroup"
            aria-labelledby="cover-picks-title"
            onKeyDown={onKey}
            onPointerLeave={() => setPointed(null)}
            data-testid="cover-picks"
          >
            {picks.map((c, i) => {
              const on = isChosen(c)
              const tabbable = on || (i === 0 && !picks.some(isChosen))
              return (
                <button
                  key={c.atSourceTime}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={tabbable ? 0 : -1}
                  aria-label={`${clock(c.atSourceTime)}, ${coverReason(c.reasons)}`}
                  className={`cover-frame${on ? ' on' : ''}`}
                  onClick={() => onPick(c)}
                  onPointerEnter={() => setPointed(c)}
                  data-testid="cover-pick"
                >
                  <img src={c.image} alt="" />
                </button>
              )
            })}
          </div>
          <p className="cover-why" data-testid="cover-why">
            {why}
          </p>
        </div>
      )}
    </section>
  )
}
