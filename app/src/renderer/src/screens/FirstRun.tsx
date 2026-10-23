// The first run, staged in the Reel screen's own layout (ux-foundation-b.md section 4): a welcome; then the sample
// is made in the player and the notes column the way an editor makes Version 1, so it shows everything the product
// does; then the editor is chosen beside it; then the app opens on a new reel with no video yet.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderInfo } from '../../../shared/api'
import { clock } from '../../../shared/progress'
import type { Step } from '../../../shared/steps'
import { reel, userMessage } from '../api'
import { Icon } from '../components/icons'
import { Logo } from '../components/brand'
import { ConnectAI } from '../components/connect'
import { StepRows } from '../components/Composer'
import { Phone, PhoneViewSwitch, usePhoneView } from '../components/Phone'
import { createPlayhead, followVideo, usePlayhead, type Playhead } from '../components/playhead'
import { useNotify } from '../App'
import { Demo, freshSteps, type View } from '../components/first-run/demo'
import { ModelLine } from '../components/first-run/ModelLine'
import { EDIT, RAW_LEN, TRANSCRIPT, tokens } from '../components/first-run/sample'
import { sound } from '../components/first-run/sound'
import { byKeyboard, reducedMotion } from '../components/motion'
import rawUrl from '../assets/sample/raw.mp4'
import aiUrl from '../assets/sample/ai.mp4'
import posterUrl from '../assets/sample/raw-poster.jpg'
import coverUrl from '../assets/sample/cover.jpg'
import candWide from '../assets/sample/cand-wide.jpg'
import candMid from '../assets/sample/cand-mid.jpg'
import candClose from '../assets/sample/cand-close.jpg'
import loafUrl from '../assets/sample/v_loaf.jpg'
import kneadUrl from '../assets/sample/v_knead.jpg'
import '../components/reel.css'
import '../components/first-run/first-run.css'

const URLS: Record<View, string> = { raw: rawUrl, v1: aiUrl }
const CAPTION = 'Good bread needs four things and a little time.'
const EASE_IN_OUT = 'cubic-bezier(.77,0,.175,1)'
const canFly = () => !reducedMotion() && !byKeyboard() && window.innerWidth > 860
const LEAVE_MS = 200

export function FirstRun({ onDone, platform }: { onDone: () => Promise<void>; platform: string }) {
  const computer = platform === 'darwin' ? 'Mac' : 'PC'
  const [start, setStart] = useState<Start | null>(null)
  const [welcomeGone, setWelcomeGone] = useState(false)
  const center = useRef<HTMLImageElement>(null)
  const player = useRef<HTMLVideoElement>(null)
  const stage = !!start
  // Both places are read on the click, before anything moves: the stage has been laid out under the welcome.
  const begin = () =>
    setStart({ flight: canFly() && center.current ? { from: center.current.getBoundingClientRect(), to: player.current!.parentElement!.getBoundingClientRect() } : null })

  return (
    <div className="fr" data-testid="first-run">
      {/* mounted under the welcome, so Get started only starts things: its frame is not the stage's mount */}
      <Stage computer={computer} start={start} video={player} onLanded={() => setWelcomeGone(true)} onDone={onDone} />
      {!welcomeGone && (
        <main className={`fr-welcome${stage ? ' leaving' : ''}${start?.flight ? ' flying' : ''}`} aria-hidden={stage || undefined} inert={stage || undefined}>
          <span className="w-logo" aria-hidden>
            <Logo size={36} />
          </span>
          <h1>Welcome to Reel Studio</h1>
          <p className="w-lead">Drop in a raw video of you talking. Your editor keeps your best takes, adds subtitles, pictures and a cover.</p>
          <div className="reels" aria-hidden>
            <img src={loafUrl} alt="" />
            <img src={posterUrl} alt="" ref={center} />
            <img src={kneadUrl} alt="" />
          </div>
          <button className="btn primary big" onClick={begin} data-testid="get-started">
            Get started
          </button>
          <p className="w-foot">Free, no account. Your videos stay on this {computer}.</p>
        </main>
      )}
    </div>
  )
}

/**
 * The middle reel moving from the welcome into the player. Both are 9:16, so one translate and scale carries it;
 * the flyer is the player's own size and corners, scaled down at the start. Resolves when it lands; it then fades
 * over the player's own first frame, so the Instagram screen under it comes in rather than popping.
 */
async function fly(src: string, from: DOMRect, to: DOMRect): Promise<void> {
  const k = from.width / to.width
  const dx = from.left + from.width / 2 - (to.left + to.width / 2)
  const dy = from.top + from.height / 2 - (to.top + to.height / 2)
  const start = `translate(${dx}px, ${dy}px) scale(${k})`
  const node = document.createElement('div')
  node.className = 'fr-flyer'
  Object.assign(node.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, transform: start })
  const img = document.createElement('img')
  img.src = src
  img.alt = ''
  node.append(img)
  document.body.append(node)
  await img.decode().catch(() => {})
  const move = node.animate([{ transform: start }, { transform: 'none' }], { duration: 360, easing: EASE_IN_OUT, fill: 'forwards' })
  const gone = () => node.remove()
  return move.finished.then(
    () => void node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' }).finished.then(gone, gone),
    gone
  )
}

/** The first run's three parts, named at the top of the notes column. */
const WHERE = ['The sample', 'Your editor', 'Your reel']

/** Get started: where the welcome's middle reel and the player were, or no flight (reduced motion, keyboard, narrow). */
type Start = { flight: { from: DOMRect; to: DOMRect } | null }
type Pane = 'sample' | 'editor'

function Stage({
  computer,
  start,
  video,
  onLanded,
  onDone
}: {
  computer: string
  /** null until Get started */
  start: Start | null
  video: React.RefObject<HTMLVideoElement | null>
  onLanded: () => void
  onDone: () => Promise<void>
}) {
  const notify = useNotify()
  const toks = useMemo(tokens, [])
  const segs = useMemo(() => TRANSCRIPT.map((s) => ({ id: s.id, toks: toks.flatMap((t, i) => (t.seg === s.id ? [{ t, i }] : [])) })), [toks])
  // the two pictures Version 1 adds: the loaf after "bread.", the hands after the kept take's "hands,"
  const picAt = useMemo(
    () =>
      new Map([
        [toks.findIndex((t) => t.seg === 'r3' && t.text === 'bread.'), { src: loafUrl, label: 'Picture: the loaf' }],
        [toks.findIndex((t) => t.seg === 'r5' && t.text === 'hands,'), { src: kneadUrl, label: 'Picture: hands kneading' }]
      ]),
    [toks]
  )
  const [pane, setPane] = useState<Pane>('sample')
  const [steps, setSteps] = useState<Step[]>(freshSteps)
  const [finished, setFinished] = useState(false)
  const [paused, setPaused] = useState(false)
  const [held, setHeld] = useState(false)
  const [view, setView] = useState<View>('raw')
  const [ai, setAi] = useState<ProviderInfo | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [soundOn, setSoundOn] = useState(sound.on)
  const [phoneView, setPhoneView] = usePhoneView()
  const [playhead] = useState(createPlayhead)
  const demo = useRef<Demo | null>(null)
  const next = useRef<HTMLButtonElement>(null)
  const still = useRef<HTMLCanvasElement>(null)
  const r = {
    subs: useRef<HTMLDivElement>(null),
    tag: useRef<HTMLSpanElement>(null),
    scrim: useRef<HTMLDivElement>(null),
    cands: useRef<HTMLDivElement>(null),
    cover: useRef<HTMLDivElement>(null)
  }
  const chips = useRef<HTMLElement[]>([])
  const segEls = useRef(new Map<string, HTMLElement>())
  const pics = useRef<HTMLElement[]>([])
  const heading = useRef<HTMLHeadingElement>(null)
  const [landed, setLanded] = useState(false)
  const landing = !!start?.flight && !landed

  useEffect(() => followVideo(() => video.current, playhead), [playhead])
  // The cover, its candidates and the editor's pictures start hidden; decoded now, their first frame on screen is not a decode.
  useEffect(() => {
    for (const im of document.querySelectorAll<HTMLImageElement>('.fr-cover img, .fr-cands img, .fr-words .pic img')) void im.decode().catch(() => {})
  }, [])

  useEffect(() => {
    const d = new Demo(
      {
        video: video.current!,
        still: still.current!,
        subs: r.subs.current!,
        tag: r.tag.current!,
        scrim: r.scrim.current!,
        cands: r.cands.current!,
        cover: r.cover.current!,
        chips: chips.current,
        segs: segEls.current,
        pics: pics.current
      },
      toks,
      URLS,
      {
        steps: setSteps,
        view: setView,
        held: setHeld,
        finished: () => setFinished(true),
        paused: setPaused
      }
    )
    demo.current = d
    const blur = () => d.holdEnd()
    const hidden = () => document.hidden && d.holdEnd()
    const keyup = (e: KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && d.holdEnd()
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keyup', keyup)
    return () => {
      d.destroy()
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keyup', keyup)
    }
    // built once for this stage
  }, [])

  useEffect(() => {
    if (!start) return
    setSoundOn(sound.on)
    let alive = true
    void (async () => {
      if (start.flight) await fly(posterUrl, start.flight.from, start.flight.to)
      else if (!byKeyboard()) await new Promise((r) => window.setTimeout(r, LEAVE_MS)) // the welcome fades out first
      if (!alive) return
      setLanded(true)
      onLanded()
      // focus was on Get started, now gone: a screen reader starts at the column
      heading.current?.focus({ preventScroll: true })
      // Skip can land during the flight: the demo is then already finished.
      if (!demo.current!.finished) void demo.current!.start()
    })()
    return () => {
      alive = false
    }
    // once, on Get started
  }, [start])

  // Skip, which had focus, is gone once the sample is done: focus moves to Continue in its place
  useEffect(() => {
    if (finished && (document.activeElement === document.body || document.activeElement === null)) next.current?.focus({ preventScroll: true })
  }, [finished])

  // a step change moves a screen reader to its heading
  useEffect(() => {
    if (pane === 'editor') heading.current?.focus({ preventScroll: true })
  }, [pane])

  const connected = (p: ProviderInfo) => setAi(p)
  // An editor already on from before counts as connected; one switched off while here does not.
  useEffect(() => {
    if (pane !== 'editor') return
    reel.ai
      .active()
      .then((p) => p.connected && p.id !== 'none' && connected(p))
      .catch(() => {})
    return reel.ai.onChange((p) => (p.connected && p.id !== 'none' ? connected(p) : setAi(null)))
  }, [pane])

  const finish = async () => {
    demo.current?.holdEnd()
    demo.current?.setPaused(true)
    setLeaving(true)
    if (!reducedMotion() && !byKeyboard()) await new Promise((r) => window.setTimeout(r, LEAVE_MS))
    try {
      await onDone()
    } catch (e) {
      // still here: the sample comes back, and the button works again
      setLeaving(false)
      notify(userMessage(e), 'error')
    }
  }

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    sound.set(next).catch((e) => notify(userMessage(e), 'error'))
  }

  const current = steps.find((s) => s.state === 'now')
  const doneCount = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length
  const version = finished ? 1 : null
  const hold = (on: boolean) => (on ? demo.current?.holdStart() : demo.current?.holdEnd())

  return (
    <div className={`fr-stage${start ? ' on' : ''}${leaving ? ' leaving' : ''}`} inert={!start || undefined}>
      <header className="fr-tb">
        <span className="rt-title">
          <h1 className="tb-h">The sample</h1>
          {version && (
            <span className="rt-ver" data-testid="version-on-screen">
              Version {version}
            </span>
          )}
        </span>
        <button className="fr-snd" aria-pressed={soundOn} onClick={toggleSound} data-testid="sound-effects">
          Sound effects: {soundOn ? 'on' : 'off'}
        </button>
      </header>
      <div className="reel-b">
        <section className="stage" aria-label="The sample reel">
          <div className={`stage-v${landing ? ' fr-landing' : ''}`}>
            <Phone view={phoneView} caption={CAPTION} className={held ? 'fr-held' : undefined} testid="sample-phone">
              <video ref={video} className="fr-v" poster={posterUrl} muted playsInline preload="auto" aria-hidden />
              <canvas ref={still} className="fr-still" aria-hidden />
              <div className="fr-subs" ref={r.subs} aria-hidden />
              <span className="reel-tag fr-tag" ref={r.tag} aria-hidden />
              <div className="fr-scrim" ref={r.scrim} />
              <div className="fr-cands" ref={r.cands} aria-hidden>
                <img src={candWide} alt="" />
                <img src={candMid} alt="" />
                <img src={candClose} alt="" data-pick />
              </div>
              <div className="fr-cover" ref={r.cover} aria-hidden>
                <img src={coverUrl} alt="" />
                <div className="cover-t">
                  You don’t need a <em>mixer</em>
                </div>
              </div>
              {finished && (
                <button
                  className="fr-hold"
                  aria-label="The sample reel. Press and hold, or hold Space, to see what you filmed."
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.currentTarget.setPointerCapture(e.pointerId)
                    hold(true)
                  }}
                  onPointerUp={() => hold(false)}
                  onPointerCancel={() => hold(false)}
                  onLostPointerCapture={() => hold(false)}
                  onKeyDown={(e) => {
                    if (e.key !== ' ' && e.key !== 'Enter') return
                    e.preventDefault()
                    if (!e.repeat) hold(true)
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  data-testid="sample-hold"
                />
              )}
            </Phone>
          </div>
          <div className="transport">
            <button
              className="pp"
              style={finished ? undefined : { visibility: 'hidden' }}
              onClick={() => demo.current?.setPaused(!paused)}
              aria-label={paused ? 'Play the sample' : 'Pause the sample'}
              data-testid="play"
            >
              <Icon name={paused ? 'play' : 'pause'} size={14} stroke={2} />
            </button>
            <Clock playhead={playhead} view={view} />
            <span className={`fr-hint${finished ? ' show' : ''}`} data-testid="hold-hint">
              Hold the video to see what you filmed.
            </span>
            <PhoneViewSwitch value={phoneView} onChange={(v) => void setPhoneView(v).catch((e) => notify(userMessage(e), 'error'))} />
          </div>
        </section>

        <div className="ncol fr-col">
          {/* the top of the column says where in the first run this is and what the column shows; the thread follows
              under it and the progress or the picker sits at the bottom, where a reel's note box is */}
          <div className="notes-h fr-h">
            <ol className="fr-where" aria-label="Getting started" data-testid="first-run-where">
              {WHERE.map((w, i) => (
                <li key={w} aria-current={i === (pane === 'sample' ? 0 : 1) ? 'step' : undefined} className={i < (pane === 'sample' ? 0 : 1) ? 'done' : undefined}>
                  {w}
                </li>
              ))}
            </ol>
            <h2 ref={heading} tabIndex={-1} id="fr-h">
              {pane === 'sample' ? 'How a reel gets made' : 'Choose your editor'}
            </h2>
            <p className="fr-lead" data-testid="first-run-lead">
              {pane === 'sample'
                ? 'A raw take of someone talking, made into Version 1 the way your editor makes yours.'
                : 'Your editor picks your best takes, adds pictures and makes the changes you ask for, on your own Claude or ChatGPT plan.'}
            </p>
          </div>
          <div className="log fr-log" role="log" aria-labelledby="fr-h">
            <div className="fr-log-in">
            <article className="nt">
              <div className="nt-ask">
                <p className="bubble">
                  <Icon name="video" size={14} stroke={1.75} />
                  Raw take · 0:24
                </p>
              </div>
              {finished ? (
                <div className="nt-res enter" data-testid="sample-v1">
                  <span className="nk ok">
                    <Icon name="check" size={12} stroke={2.4} />
                  </span>
                  <b className="v">Version 1</b>
                  <span className="sep" aria-hidden>
                    ·
                  </span>
                  <span className="t">0:24 down to {EDIT.len}</span>
                </div>
              ) : (
                <div className="nt-res quiet" aria-busy>
                  <span className="nk">
                    <span className="spin" />
                  </span>
                  <span className="t">Making Version 1</span>
                </div>
              )}
              <p className="fr-words" data-testid="sample-words">
                <b>Heard</b>{' '}
                {segs.map((s) => (
                  <span
                    key={s.id}
                    className="fr-seg"
                    ref={(el) => {
                      if (el) segEls.current.set(s.id, el)
                    }}
                  >
                    {s.toks.map(({ t, i }) => {
                      const pic = picAt.get(i)
                      return (
                        <Fragment key={i}>
                          <span
                            ref={(el) => {
                              if (el) chips.current[i] = el
                            }}
                            className={`tk${t.text ? '' : ' pz'}`}
                            aria-label={t.text ? undefined : `pause, ${t.pause}`}
                          >
                            {t.text ?? t.pause}
                          </span>{' '}
                          {pic && (
                            <>
                              <span
                                className="tk in pic gone"
                                role="img"
                                aria-label={pic.label}
                                ref={(el) => {
                                  if (el && !pics.current.includes(el)) pics.current.push(el)
                                }}
                              >
                                <img src={pic.src} alt="" />
                              </span>{' '}
                            </>
                          )}
                        </Fragment>
                      )
                    })}
                  </span>
                ))}
              </p>
            </article>
            </div>
          </div>

          <div className="cbox bare">
            <div className={`stripwrap${!finished ? ' on' : ''}`}>
              <div>
                {!finished && (
                  <>
                    <div className="steps on">
                      <div>
                        <ul aria-label="Steps" data-testid="steps-list">
                          <StepRows steps={steps} />
                        </ul>
                      </div>
                    </div>
                    <div className="strip" role="status" data-testid="note-progress">
                      <span className="bar" aria-hidden>
                        <i style={{ transform: `scaleX(${(doneCount + (current ? 0.5 : 0)) / steps.length})` }} />
                      </span>
                      <span className="spin light" aria-hidden />
                      <b>Making Version 1</b>
                      {/* the list above names the step; the strip says how far along */}
                      <span className="m">{current ? ` · Step ${steps.indexOf(current) + 1} of ${steps.length}` : ''}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            {pane === 'editor' && (
              <div className="connect-cin fr-pick" data-testid="composer-connect">
                <ConnectAI onConnected={connected} />
              </div>
            )}
          </div>

          <footer className="fr-foot">
            <ModelLine active={!!start} computer={computer} />
            <span className="sp" />
            {pane === 'sample' && !finished && (
              <button className="btn ghost" onClick={() => demo.current?.skip()} data-testid="demo-skip">
                Skip
              </button>
            )}
            {pane === 'sample' && finished && (
              <button ref={next} className="btn primary" onClick={() => setPane('editor')} data-testid="demo-next">
                Continue
              </button>
            )}
            {pane === 'editor' && (
              <button className={`btn${ai ? ' primary' : ''}`} onClick={() => void finish()} disabled={leaving} data-testid={ai ? 'editor-continue' : 'not-now'}>
                {ai ? 'Continue' : 'Not now'}
              </button>
            )}
          </footer>
        </div>
      </div>
    </div>
  )
}

/** The time on the sample and its length, as the log states it: one render a second while it plays. */
function Clock({ playhead, view }: { playhead: Playhead; view: View }) {
  const second = usePlayhead(playhead, Math.floor)
  const dur = view === 'raw' ? RAW_LEN : EDIT.dur
  return (
    <span className="tc" data-testid="time">
      {clock(Math.min(second, Math.floor(dur)))} <span>/ {view === 'raw' ? clock(RAW_LEN) : EDIT.len}</span>
    </span>
  )
}
