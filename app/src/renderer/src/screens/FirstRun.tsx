// The first run: a welcome, then a stage where the bundled sample edits itself in a phone while setup happens in a
// side panel beside it (the listening model downloading, the Mac's questions, an AI editor), ending on Home.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderInfo } from '../../../shared/api'
import { reel } from '../api'
import { Icon } from '../components/icons'
import { ConnectAI, USING_CLAUDE_CODE } from '../components/connect'
import { BrandMark } from '../components/brand'
import { providerName } from '../components/Sidebar'
import { NEVER_SHARED } from '../components/ModelsAndPrivacy'
import { Demo } from '../components/first-run/demo'
import { MacPane } from '../components/first-run/MacPane'
import { ModelLine, useListeningModel } from '../components/first-run/ModelLine'
import { tokens } from '../components/first-run/sample'
import { sound } from '../components/first-run/sound'
import { fly, handOffSample } from '../components/first-run/handoff'
import { byKeyboard, reducedMotion } from '../components/motion'
import rawUrl from '../assets/sample/raw.mp4'
import simpleUrl from '../assets/sample/simple.mp4'
import aiUrl from '../assets/sample/ai.mp4'
import posterUrl from '../assets/sample/raw-poster.jpg'
import coverUrl from '../assets/sample/cover.jpg'
import candWide from '../assets/sample/cand-wide.jpg'
import candMid from '../assets/sample/cand-mid.jpg'
import candClose from '../assets/sample/cand-close.jpg'
import loafUrl from '../assets/sample/v_loaf.jpg'
import kneadUrl from '../assets/sample/v_knead.jpg'
import '../components/first-run/first-run.css'

type Pane = 'sample' | 'mac' | 'ai' | 'share'
const STEP_NAMES: Record<Exclude<Pane, 'share'>, string> = { sample: 'The sample', mac: 'Your Mac', ai: 'AI editor' }
const BEATS: [string, string][] = [
  ['Write down every word', ''],
  ['Cut the pauses and false starts', '0:24 → 0:12'],
  ['Add subtitles', 'Key words marked'],
  ['Pick a cover', 'Smiling at the camera']
]
const EASE_OUT = 'cubic-bezier(.23,1,.32,1)'
const canFly = () => !reducedMotion() && !byKeyboard() && window.innerWidth > 860

export function FirstRun({ onDone, platform }: { onDone: () => void; platform: string }) {
  const mac = platform === 'darwin'
  const computer = mac ? 'Mac' : 'PC'
  const [stage, setStage] = useState(false)
  const model = useListeningModel()
  const go = useRef<HTMLButtonElement>(null)
  const center = useRef<HTMLImageElement>(null)
  const welcome = useRef<HTMLDivElement>(null)
  const [from, setFrom] = useState<DOMRect | null>(null)

  useEffect(() => go.current?.focus({ preventScroll: true }), [])

  const start = () => {
    sound.unlock()
    setFrom(canFly() ? (center.current?.getBoundingClientRect() ?? null) : null)
    setStage(true)
  }

  return (
    <div className="fr" data-testid="first-run">
      <SoundToggle />
      {!stage ? (
        <main className="fr-welcome" ref={welcome}>
          <div className="w-logo">
            <Icon name="play" size={28} stroke={1.75} />
          </div>
          <h1>Welcome to Reel Studio</h1>
          <p className="w-lead">
            Drop in a raw video of you talking. I keep your best takes, add subtitles, pictures and a cover, and hand you a reel ready for Instagram.
          </p>
          <div className="reels" aria-hidden>
            <img src={loafUrl} alt="" />
            <img src={posterUrl} alt="" ref={center} />
            <img src={kneadUrl} alt="" />
          </div>
          <button ref={go} className="btn primary big" onClick={start} data-testid="get-started">
            Get started
          </button>
          <p className="w-foot">Free, no account. Your videos stay on this {computer}.</p>
        </main>
      ) : (
        <Stage mac={mac} computer={computer} model={model} from={from} onDone={onDone} />
      )}
    </div>
  )
}

function SoundToggle() {
  const [on, setOn] = useState(sound.on)
  return (
    <button
      className="fr-snd"
      aria-pressed={on}
      aria-label="Sound"
      title={on ? 'Sound on' : 'Sound off'}
      onClick={() => {
        sound.unlock()
        sound.set(!on)
        setOn(!on)
      }}
    >
      <Icon name={on ? 'volume' : 'mute'} size={16} />
    </button>
  )
}

function Stage({
  mac,
  computer,
  model,
  from,
  onDone
}: {
  mac: boolean
  computer: string
  model: ReturnType<typeof useListeningModel>
  from: DOMRect | null
  onDone: () => void
}) {
  const toks = useMemo(tokens, [])
  const keys = useMemo<Exclude<Pane, 'share'>[]>(() => (mac ? ['sample', 'mac', 'ai'] : ['sample', 'ai']), [mac])
  const [pane, setPane] = useState<Pane>('sample')
  const [beats, setBeats] = useState<('' | 'on' | 'done')[]>(['', '', '', ''])
  const [finished, setFinished] = useState(false)
  const [paused, setPaused] = useState(false)
  const [ai, setAi] = useState<ProviderInfo | null>(null)
  const [added, setAdded] = useState<string[]>([])
  const demo = useRef<Demo | null>(null)
  const r = {
    phone: useRef<HTMLDivElement>(null),
    scr: useRef<HTMLDivElement>(null),
    raw: useRef<HTMLVideoElement>(null),
    simple: useRef<HTMLVideoElement>(null),
    ai: useRef<HTMLVideoElement>(null),
    subs: useRef<HTMLDivElement>(null),
    ptag: useRef<HTMLSpanElement>(null),
    scrim: useRef<HTMLDivElement>(null),
    cands: useRef<HTMLDivElement>(null),
    cover: useRef<HTMLDivElement>(null),
    words: useRef<HTMLParagraphElement>(null),
    lenNow: useRef<HTMLSpanElement>(null),
    lenWas: useRef<HTMLSpanElement>(null),
    note: useRef<HTMLParagraphElement>(null),
    rail: useRef<HTMLElement>(null),
    script: useRef<HTMLDivElement>(null)
  }
  const chips = useRef<HTMLElement[]>([])
  const heading = useRef<HTMLHeadingElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)
  // "Skip the demo" leaves the page when the demo ends; focus that was on it moves to the next step's button.
  useEffect(() => {
    if (finished && (document.activeElement === document.body || document.activeElement === null)) nextBtn.current?.focus({ preventScroll: true })
  }, [finished])

  useEffect(() => {
    const d = new Demo(
      {
        phone: r.phone.current!,
        scr: r.scr.current!,
        videos: { raw: r.raw.current!, simple: r.simple.current!, ai: r.ai.current! },
        subs: r.subs.current!,
        ptag: r.ptag.current!,
        scrim: r.scrim.current!,
        cands: r.cands.current!,
        cover: r.cover.current!,
        words: r.words.current!,
        lenNow: r.lenNow.current!,
        lenWas: r.lenWas.current!,
        note: r.note.current!,
        chips: chips.current
      },
      toks,
      {
        beat: (i, st) => setBeats((b) => b.map((x, j) => (j === i ? st : x))),
        finished: () => setFinished(true),
        paused: setPaused
      }
    )
    demo.current = d
    let alive = true
    void (async () => {
      // the welcome's middle reel flies into the phone; the panel and the words follow
      if (from) {
        const scr = r.scr.current!
        scr.classList.add('landing')
        r.rail.current?.animate(
          [
            { opacity: 0, transform: 'translateX(24px)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: 420, delay: 160, easing: EASE_OUT, fill: 'backwards' }
        )
        r.script.current?.animate(
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: 420, delay: 280, easing: EASE_OUT, fill: 'backwards' }
        )
        await fly(posterUrl, from, scr.getBoundingClientRect(), 14, 38, 560)
        scr.classList.remove('landing')
      }
      // Skip can land during the flight: the demo is already finished, and focus stays where Skip put it.
      if (!alive || d.finished) return
      heading.current?.focus({ preventScroll: true })
      void d.start()
    })()
    const blur = () => d.holdEnd()
    const hidden = () => document.hidden && d.holdEnd()
    const keyup = (e: KeyboardEvent) => (e.key === ' ' || e.key === 'Enter') && d.holdEnd()
    window.addEventListener('blur', blur)
    document.addEventListener('visibilitychange', hidden)
    document.addEventListener('keyup', keyup)
    return () => {
      alive = false
      d.destroy()
      window.removeEventListener('blur', blur)
      document.removeEventListener('visibilitychange', hidden)
      document.removeEventListener('keyup', keyup)
    }
    // built once for this stage
  }, [])

  const next = useCallback(() => {
    const i = keys.indexOf(pane as Exclude<Pane, 'share'>)
    setPane(i >= 0 && i < keys.length - 1 ? keys[i + 1] : 'share')
  }, [keys, pane])
  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [pane])
  const afterDemo = () => (mac ? setPane('mac') : setPane('ai'))

  const aiOn = useRef(false)
  const [changing, setChanging] = useState(false)
  const connected = (p: ProviderInfo) => {
    setAi(p)
    setChanging(false)
    if (aiOn.current) return
    aiOn.current = true
    void demo.current?.upgrade(
      [
        ['bread.', loafUrl, 'Picture: the loaf'],
        ['hands,', kneadUrl, 'Picture: hands kneading']
      ],
      (t) => setAdded((a) => [...a, t])
    )
  }
  // A provider already on from earlier counts as connected.
  useEffect(() => {
    if (pane !== 'ai') return
    reel.ai
      .active()
      .then((p) => p.connected && p.id !== 'none' && connected(p))
      .catch(() => {})
    return reel.ai.onChange((p) => (p.connected && p.id !== 'none' ? connected(p) : setAi(null)))
  }, [pane])

  const finish = async () => {
    demo.current?.holdEnd()
    demo.current?.setPaused(true)
    handOffSample({ from: canFly() ? (r.scr.current?.getBoundingClientRect() ?? null) : null, upgraded: !!ai })
    onDone()
  }

  const stepAt = pane === 'share' ? keys.length : keys.indexOf(pane)
  return (
    <div className="fr-stage">
      <div className="fr-main">
        <div className="fr-pcol">
          <div
            ref={r.phone}
            className={`fr-phone${finished ? ' holdable' : ''}`}
            tabIndex={finished ? 0 : -1}
            role={finished ? 'button' : 'img'}
            aria-label={finished ? 'The sample reel. Press and hold, or hold Space, to see the original.' : 'The sample reel'}
            onPointerDown={(e) => {
              if (e.button !== 0 || !finished) return
              e.currentTarget.setPointerCapture(e.pointerId)
              demo.current?.holdStart()
            }}
            onPointerUp={() => demo.current?.holdEnd()}
            onPointerCancel={() => demo.current?.holdEnd()}
            onLostPointerCapture={() => demo.current?.holdEnd()}
            onKeyDown={(e) => {
              if (e.key !== ' ' && e.key !== 'Enter') return
              e.preventDefault()
              if (!e.repeat) demo.current?.holdStart()
            }}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="sample-phone"
          >
            <div className="scr" ref={r.scr}>
              <video ref={r.raw} src={rawUrl} poster={posterUrl} muted playsInline preload="auto" />
              <video ref={r.simple} className="off" src={simpleUrl} muted playsInline loop preload="auto" />
              <video ref={r.ai} className="off" src={aiUrl} muted playsInline loop preload="auto" />
              <div className="subs" ref={r.subs} aria-hidden />
              <span className="island" />
              <div className="sbar" aria-hidden>
                <span>9:41</span>
                <span className="bat">
                  <i />
                </span>
              </div>
              <span className="homebar" />
              <span className="ptag" ref={r.ptag} />
              <div className="scrim" ref={r.scrim} />
              <div className="cands" ref={r.cands} aria-hidden>
                <img src={candWide} alt="" />
                <img src={candMid} alt="" />
                <img src={candClose} alt="" data-pick />
              </div>
              <div className="cover" ref={r.cover}>
                <img src={coverUrl} alt="" />
                <div className="cover-t">
                  You don’t need a <em>mixer</em>
                </div>
              </div>
            </div>
          </div>
          <div className="under">
            <span className={`hold-hint${finished ? ' show' : ''}`}>
              <Icon name="original" size={16} /> Hold the video to see the original
            </span>
            {finished && (
              <button className="icon-btn small" onClick={() => demo.current?.setPaused(!paused)} aria-label={paused ? 'Play the sample' : 'Pause the sample'}>
                <Icon name={paused ? 'play' : 'pause'} size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="script" ref={r.script}>
          <div className="script-h">
            <span className="script-l">The sample</span>
            <span className="len">
              <span className="len-was" ref={r.lenWas} />
              <span className="len-now" ref={r.lenNow}>
                0:24
              </span>
            </span>
          </div>
          <p className="script-note" ref={r.note} aria-live="polite" />
          <p className="words" ref={r.words}>
            {toks.map((t, i) => (
              <span key={i}>
                <span
                  ref={(el) => {
                    if (el) chips.current[i] = el
                  }}
                  className={`tk${t.text ? '' : ' pz'}`}
                  aria-label={t.text ? undefined : `pause, ${t.pause}`}
                >
                  {t.text ?? t.pause}
                </span>{' '}
              </span>
            ))}
          </p>
        </div>
      </div>

      <aside className="fr-rail" ref={r.rail} aria-label="Set up Reel Studio">
        <ol className="fr-steps" aria-label="Setup">
          {keys.map((k, j) => (
            <li
              key={k}
              className={j < stepAt ? 'done' : j === stepAt ? 'on' : undefined}
              aria-current={j === stepAt ? 'step' : undefined}
              data-testid={`setup-step-${k}`}
            >
              {STEP_NAMES[k]}
            </li>
          ))}
        </ol>
        <div className="fr-panes">
          <section className="fr-pane" key={pane} aria-labelledby="fr-h">
            {pane === 'sample' && (
              <>
                <h2 id="fr-h" tabIndex={-1} ref={heading}>
                  Watch me edit a sample
                </h2>
                <p className="lead">This is what I’ll do with your video.</p>
                <ol className="beats">
                  {BEATS.map(([t, d], i) => (
                    <li key={t} className={`beat ${beats[i]}`}>
                      <span>{t}</span>
                      <span className="det">{i === 0 ? `${toks.filter((x) => x.text).length} words` : d}</span>
                    </li>
                  ))}
                </ol>
                <div className="pane-foot">
                  {!finished && (
                    <button className="link inline" onClick={() => demo.current?.skip()} data-testid="demo-skip">
                      Skip the demo
                    </button>
                  )}
                  <button
                    ref={nextBtn}
                    className={`btn primary big reveal${finished ? ' show' : ''}`}
                    inert={!finished || undefined}
                    onClick={afterDemo}
                    data-testid="demo-next"
                  >
                    {mac ? 'Get your Mac ready' : 'Connect your AI editor'}
                  </button>
                </div>
              </>
            )}
            {pane === 'mac' && (
              <>
                <h2 id="fr-h" tabIndex={-1} ref={heading}>
                  Get your Mac ready
                </h2>
                <p className="lead">Your Mac asks about each of these once. I’ll say why before it does.</p>
                <MacPane onDone={next} />
                <div className="pane-foot">
                  <p className="note">You can change any of these later in System Settings.</p>
                </div>
              </>
            )}
            {pane === 'ai' && (
              <>
                <h2 id="fr-h" tabIndex={-1} ref={heading}>
                  Connect your AI editor
                </h2>
                <p className="lead">It picks your best take, adds pictures and makes changes when you ask.</p>
                <div className="fr-ai">{ai && !changing ? <Connected p={ai} onChange={() => setChanging(true)} /> : <ConnectAI onConnected={connected} />}</div>
                {added.length > 0 && (
                  <div className="changed" aria-live="polite">
                    <h3>What an AI editor adds to the sample</h3>
                    <ol>
                      {added.map((t) => (
                        <li key={t}>
                          <Icon name="check" size={14} stroke={2.4} /> {t}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
                <div className="pane-foot">
                  {!ai && <p className="note">Without one I make a simple cut, like the sample now. You can connect later.</p>}
                  <button className={`btn ${ai ? 'primary big' : ''}`} onClick={next} data-testid="skip">
                    {ai ? 'Continue' : 'Skip for now'}
                  </button>
                </div>
                {ai && (
                  <span className="sr-only" role="status">
                    {ai.id === 'claude-cli' ? USING_CLAUDE_CODE : `Connected to ${ai.label}.`}
                  </span>
                )}
              </>
            )}
            {pane === 'share' && <SharePane heading={heading} onDone={() => void finish()} />}
          </section>
        </div>
        <ModelLine model={model} place="panel" computer={computer} />
      </aside>
    </div>
  )
}

/** Once an editor is on, one row says which, so what it adds to the sample stays in view. */
function Connected({ p, onChange }: { p: ProviderInfo; onChange: () => void }) {
  const brand = p.id === 'claude' || p.id === 'claude-cli' ? 'claude' : p.id === 'chatgpt' || p.id === 'codex-cli' ? 'openai' : null
  return (
    <div className="fr-connected" data-testid="ai-connected-row">
      <span className="av">{brand ? <BrandMark name={brand} size={18} /> : <Icon name="server" size={16} />}</span>
      <span className="t">
        <b>Connected to {providerName(p)}</b>
        <span>{p.id === 'claude-cli' ? 'Your Claude Code app' : p.id === 'codex-cli' ? 'Your Codex app' : (p.detail ?? 'AI editor')}</span>
      </span>
      <button className="link inline" onClick={onChange}>
        Change
      </button>
      <Icon name="check" size={16} stroke={2.2} />
    </div>
  )
}

/** Asked once, as a plain choice: two equal buttons, nothing preselected, the same words as Settings › Privacy. */
function SharePane({ heading, onDone }: { heading: React.RefObject<HTMLHeadingElement | null>; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const answer = async (on: boolean) => {
    setBusy(true)
    await reel.app.setSharing({ asked: true, on, usage: true, quality: true, posts: true }).catch(() => undefined)
    onDone()
  }
  return (
    <>
      <h2 id="fr-h" tabIndex={-1} ref={heading}>
        Help improve Reel Studio?
      </h2>
      <p className="lead">You can share anonymous data: which features you use and errors, a score for each edit, and view counts of reels you post.</p>
      <p className="never share-never">
        <Icon name="lock" size={14} />
        {NEVER_SHARED}
      </p>
      <div className="pane-foot">
        <p className="note">You can change this any time in Settings › Privacy.</p>
        <span className="row">
          <button className="btn" disabled={busy} onClick={() => void answer(false)} data-testid="share-no">
            Don’t share
          </button>
          <button className="btn" disabled={busy} onClick={() => void answer(true)} data-testid="share-yes">
            Share
          </button>
        </span>
      </div>
    </>
  )
}
