// The shape of T3 Code's WelcomeWizard: a welcome, then named stages with one action each.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../components/icons'
import { Logo } from '../components/brand'
import { MacStage } from './setup/MacStage'
import { ListeningStage } from './setup/ListeningStage'
import { ConnectStage } from './setup/ConnectStage'
import { reel } from '../api'
import { NEVER_SHARED } from '../components/ModelsAndPrivacy'

type SetupStage = 'mac' | 'listening' | 'ai'
const STAGE_LABELS: Record<SetupStage, string> = { mac: 'Your Mac', listening: 'Listening', ai: 'AI editor' }

export function FirstRun({ onDone, platform }: { onDone: () => void; platform: string }) {
  // Only macOS asks privacy questions. The folder comes first, because macOS asks about Documents when it is made.
  const stages = useMemo<SetupStage[]>(() => (platform === 'darwin' ? ['mac', 'listening', 'ai'] : ['listening', 'ai']), [platform])
  const [stage, setStage] = useState<SetupStage | null>(null) // null = the welcome
  // After the last stage: one question about sharing anonymous data, asked once, with nothing preselected.
  const [askShare, setAskShare] = useState(false)
  // Forward slides in from the right, back from the left: the stage strip reads left to right.
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  const next = useCallback(() => {
    setDir('fwd')
    setStage((s) => (s === null ? stages[0] : (stages[stages.indexOf(s) + 1] ?? s)))
  }, [stages])
  const back = (s: SetupStage) => {
    setDir('back')
    setStage(s)
  }

  if (stage === null) {
    return (
      <main className="first">
        <div className="first-card">
          <div className="hero-mark">
            <Logo size={44} />
          </div>
          <h1>Welcome to Reel Studio</h1>
          <p className="muted" style={{ fontSize: 17, maxWidth: 440 }}>
            Drop in a video of you talking. I cut it, add captions, music and a cover, and get it ready for Instagram.
          </p>
          <button className="btn primary big" onClick={next} data-testid="get-started">
            Get started
          </button>
        </div>
      </main>
    )
  }

  if (askShare) return <ShareQuestion onDone={onDone} />

  const at = stages.indexOf(stage)
  return (
    <main className="first setup-view">
      <div className="setup" role="group" aria-labelledby="setup-title">
        <div className="setup-head">
          <span className="logo" aria-hidden>
            <Logo />
          </span>
          <span id="setup-title">Set up Reel Studio</span>
        </div>
        <ol className="setup-steps" aria-label="Setup progress" data-testid="setup-steps">
          {stages.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                className="setup-step"
                data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}
                aria-current={i === at ? 'step' : undefined}
                aria-label={`${STAGE_LABELS[s]}, step ${i + 1} of ${stages.length}${i < at ? ', done' : ''}`}
                // Earlier stages can be opened again; later ones are reached by finishing this one.
                disabled={i >= at}
                onClick={() => back(s)}
                data-testid={`setup-step-${s}`}
              >
                <span className="setup-step-mark" aria-hidden>
                  {i < at ? <Icon name="check" size={13} stroke={2.5} /> : i + 1}
                </span>
                <span className="setup-step-label">{STAGE_LABELS[s]}</span>
              </button>
            </li>
          ))}
        </ol>
        <section className="setup-panel">
          <div className="setup-stage" key={stage} data-dir={dir}>
            {stage === 'mac' && <MacStage onNext={next} />}
            {stage === 'listening' && <ListeningStage onNext={next} />}
            {stage === 'ai' && <ConnectStage onDone={() => setAskShare(true)} />}
          </div>
        </section>
      </div>
    </main>
  )
}

/** Two equal answers and no default: the person decides, and Settings › Privacy uses the same words. */
function ShareQuestion({ onDone }: { onDone: () => void }) {
  const title = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => title.current?.focus(), [])
  const answer = async (on: boolean) => {
    setBusy(true)
    await reel.app.setSharing({ asked: true, on, usage: true, quality: true, posts: true }).catch(() => undefined)
    onDone()
  }
  return (
    <main className="first setup-view">
      <div className="setup share-q" role="group" aria-labelledby="share-title">
        <div className="setup-head">
          <span className="logo" aria-hidden>
            <Logo />
          </span>
          <span>Set up Reel Studio</span>
        </div>
        <section className="setup-panel">
          <div className="setup-stage">
            <h2 className="stage-title" id="share-title" tabIndex={-1} ref={title}>
              Help improve Reel Studio?
            </h2>
            <p className="stage-desc">You can share anonymous data: which features you use and errors, a score for each edit, and view counts of reels you post.</p>
            <p className="never share-never">
              <Icon name="lock" size={14} />
              {NEVER_SHARED}
            </p>
            <div className="stage-foot">
              <span className="stage-note">You can change this any time in Settings › Privacy.</span>
              <button className="btn" disabled={busy} onClick={() => void answer(false)} data-testid="share-no">
                Don't share
              </button>
              <button className="btn" disabled={busy} onClick={() => void answer(true)} data-testid="share-yes">
                Share
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
