import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { PermissionStatus } from '../../../../shared/api'
import { reel, userMessage } from '../../api'
import { Icon, type IconName } from '../icons'
import { usePermissionStatus } from '../permissions'
import { sound } from './sound'

const SAID_NO = 'Your Mac said no. Press Allow to turn it on in System Settings.'

/**
 * "Get your Mac ready": one card per thing the Mac asks about, each saying why before the Mac does. A card opens,
 * the person answers the Mac, and the next one opens on its own. Every state comes from main's permission status
 * (main/permissions.ts), which also opens System Settings and its helper when the Mac says no. Nothing plays a
 * sound while the Mac is asking. There is no microphone card: Reel Studio does not listen to the microphone.
 */
export function MacPane({ onDone }: { onDone: () => void }) {
  const { status, apply } = usePermissionStatus()
  const [step, setStep] = useState(0)
  const [skipped, setSkipped] = useState(false)
  const [busy, setBusy] = useState<'folder' | 'notifications' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const primary = useRef<HTMLButtonElement>(null)

  const folderOk = status?.folder === 'allowed'
  const notifyCard = !!status && status.notifications !== 'unsupported'
  const notifyOk = status?.notifications === 'unverified'
  const count = notifyCard ? 2 : 1
  const answered = step === 0 ? folderOk : notifyOk || skipped

  useEffect(() => {
    if (!status) return
    if (step >= count) {
      const t = window.setTimeout(onDone, 500)
      return () => window.clearTimeout(t)
    }
    if (answered) {
      const t = window.setTimeout(() => setStep((s) => s + 1), skipped && step === 1 ? 350 : 650)
      return () => window.clearTimeout(t)
    }
    // The pane's heading has focus when it opens, so a screen reader starts there; after an answer the next card's button takes it.
    if (step > 0) primary.current?.focus({ preventScroll: true })
  }, [status, step, count, answered, skipped, onDone])

  const run = (which: 'folder' | 'notifications', fn: () => Promise<PermissionStatus>) => async () => {
    setBusy(which)
    setError(null)
    try {
      apply(await sound.hush(fn))
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const allowFolder = run('folder', () => reel.perm.allowFolder())
  const turnOn = run('notifications', () => reel.perm.setNotifications(true))
  // The system folder picker gives access to the folder picked in it, so no second question follows.
  const choose = async () => {
    const p = await sound.hush(() => reel.app.chooseFolder())
    if (!p) return
    await run('folder', async () => {
      await reel.app.setRoot(p)
      return reel.perm.status()
    })()
  }

  const ref = (i: number) => (i === step ? primary : undefined)
  const chooseLink = (
    <button className="link inline" onClick={() => void choose()} disabled={busy !== null} data-testid="perm-folder-choose">
      Use another folder…
    </button>
  )
  let folderBody: ReactNode
  if (status?.folder === 'unusable')
    folderBody = (
      <>
        <p className="perm-problem" data-testid="perm-folder-problem">
          I can’t save in this folder. Use another one.
        </p>
        <div className="row">
          <button ref={ref(0)} className="btn small primary" onClick={() => void choose()} disabled={busy !== null}>
            Use another folder…
          </button>
        </div>
      </>
    )
  else
    folderBody = (
      <>
        {status?.folder === 'denied' ? (
          <p className="perm-problem" data-testid="perm-folder-problem">
            {SAID_NO}
          </p>
        ) : (
          <p>Your Mac asks once before I can keep your videos in your Documents folder.</p>
        )}
        <div className="row">
          <button ref={ref(0)} className="btn small primary" disabled={busy !== null} onClick={() => void allowFolder()} data-testid="perm-folder-allow">
            {busy === 'folder' ? 'Asking your Mac…' : 'Allow'}
          </button>
          {chooseLink}
        </div>
        {status?.folder === 'denied' && (
          <p className="waiting" role="status">
            I’ll notice when it’s on.
          </p>
        )}
      </>
    )

  const asking = busy === 'notifications' || status?.notifications === 'asking'
  const notifyBody = (
    <>
      {status?.notifications === 'blocked' ? (
        <p className="perm-problem" data-testid="perm-notifications-problem">
          {SAID_NO}
        </p>
      ) : asking ? (
        <p>Your Mac asks in the corner of the screen. Choose Allow.</p>
      ) : (
        <p>A reel takes a few minutes. Do something else and I’ll let you know.</p>
      )}
      <div className="row">
        {status?.notifications === 'asking' && busy === null ? (
          <button ref={ref(1)} className="btn small" onClick={() => void turnOn()} data-testid="perm-notifications-retry">
            Ask again
          </button>
        ) : (
          <button ref={ref(1)} className="btn small primary" disabled={busy !== null} onClick={() => void turnOn()} data-testid="perm-notifications-allow">
            Allow
          </button>
        )}
        <button className="link inline" onClick={() => setSkipped(true)} disabled={busy !== null} data-testid="perm-notifications-skip">
          Not now
        </button>
      </div>
    </>
  )

  const cards: { k: string; icon: IconName; title: string; sub: string; optional?: boolean; ok: boolean; done: string; body: ReactNode }[] = [
    {
      k: 'folder',
      icon: 'folder',
      title: 'Keep your videos in one folder',
      sub: status?.folderDisplay ?? 'Documents › Reel Studio',
      ok: folderOk,
      done: 'Allowed',
      body: folderBody
    }
  ]
  if (notifyCard)
    cards.push({
      k: 'notifications',
      icon: 'bell',
      title: 'Tell you when a reel is ready',
      optional: true,
      sub: 'Notifications',
      ok: notifyOk,
      done: 'Turned on',
      body: notifyBody
    })

  return (
    <div className="perms" data-testid="stage-mac">
      {cards.map((c, i) => {
        const skip = i === 1 && skipped && !c.ok
        const open = i === step && !c.ok && !skip
        return (
          <div
            key={c.k}
            className={`fr-perm${open ? ' open' : ''}${c.ok ? ' ok' : ''}${i > step ? ' wait' : ''}`}
            data-testid={`perm-${c.k}`}
            data-state={c.ok ? 'allowed' : skip ? 'skipped' : open ? 'ask' : 'todo'}
          >
            <div className="perm-h">
              <span className="ic">
                <Icon name={c.icon} size={16} />
              </span>
              <span className="perm-t">
                <b>
                  {c.title}
                  {c.optional && <span className="opt-tag">Optional</span>}
                </b>
                <span className="s">{c.sub}</span>
              </span>
              {(c.ok || skip) && (
                <span className="st">
                  {c.ok ? (
                    <>
                      <Icon name="check" size={14} stroke={2.2} /> {c.done}
                    </>
                  ) : (
                    'Skipped'
                  )}
                </span>
              )}
            </div>
            <div className="perm-body" inert={!open || undefined}>
              <div>
                <div className="perm-in">
                  {c.body}
                  {open && error && <p className="perm-problem">{error}</p>}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
