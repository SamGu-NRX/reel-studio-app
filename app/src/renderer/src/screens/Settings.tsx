import { useEffect, useRef, useState } from 'react'
import type { AppInfo, PermissionStatus } from '../../../shared/api'
import { RELEASES_URL } from '../../../shared/config'
import { reel, userMessage } from '../api'
import type { Go, SettingsSection } from '../nav'
import { ConnectAI, DevProviders, ModelDownload, USING_CLAUDE_CODE } from '../components/connect'
import { usePermissionStatus } from '../components/permissions'
import { FOLDER_APP } from '../components/ui'
import { Icon } from '../components/icons'
import { useUpdateState } from '../components/update'
import { UpdateSettingsRow } from '../components/UpdateSettings'
import { useNotify } from '../App'
import { Models, Privacy } from '../components/ModelsAndPrivacy'
import '../components/settings.css'

const SECTIONS: [SettingsSection, string][] = [
  ['ai', 'Your AI editor'],
  ['listen', 'Listening model'],
  ['where', 'Where videos are kept'],
  ['notify', 'Notifications'],
  ['privacy', 'Privacy'],
  ['about', 'About and updates']
]

export function Settings({ info, onInfo, section }: { info: AppInfo; onInfo: (i: AppInfo) => void; go?: Go; section?: SettingsSection }) {
  const notify = useNotify()
  const [current, setCurrent] = useState<SettingsSection>(section ?? 'ai')
  const page = useRef<HTMLDivElement>(null)
  const lock = useRef(0)
  // The side list marks the section being read, so a long page never loses its place.
  useEffect(() => {
    const root = page.current?.closest('.main') ?? null
    const seen = new Map<Element, boolean>()
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => seen.set(e.target, e.isIntersecting))
        const top = Array.from(document.querySelectorAll('.sblock')).find((b) => seen.get(b))
        if (top && performance.now() > lock.current) setCurrent(top.id.replace('sec-', '') as SettingsSection)
      },
      { root, rootMargin: '0px 0px -60% 0px' }
    )
    document.querySelectorAll('.sblock').forEach((b) => io.observe(b))
    if (section && section !== 'ai') document.getElementById(`sec-${section}`)?.scrollIntoView({ block: 'start' })
    return () => io.disconnect()
  }, [section])
  const goTo = (k: SettingsSection) => {
    lock.current = performance.now() + 1000
    setCurrent(k)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('kb')
    document.getElementById(`sec-${k}`)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }
  const update = useUpdateState()
  const [savingExports, setSavingExports] = useState(false)
  const toggleExports = async (on: boolean) => {
    setSavingExports(true)
    try {
      onInfo(await reel.app.setFasterExports(on))
    } catch (e) {
      notify(userMessage(e), 'error')
    } finally {
      setSavingExports(false)
    }
  }
  const toggleUpdates = async (on: boolean) => {
    try {
      await reel.update.setEnabled(on)
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  // Re-checked while Settings is open, so a change made in System Settings shows here.
  const { status: perm, apply } = usePermissionStatus()
  // What a request that is still out asked for. "asking" can also mean macOS never answered; the switch stays usable.
  const [pending, setPending] = useState<'folder' | { notifications: boolean } | null>(null)
  const request = async (what: NonNullable<typeof pending>, fn: () => Promise<PermissionStatus>) => {
    setPending(what)
    try {
      apply(await fn())
    } catch (e) {
      notify(userMessage(e), 'error')
    } finally {
      setPending(null)
    }
  }
  const toggleAlerts = (on: boolean) => request({ notifications: on }, () => reel.perm.setNotifications(on))
  const alerts = perm?.notifications
  const alertsOn = pending && pending !== 'folder' ? pending.notifications : alerts !== 'off'
  const isMac = info.platform === 'darwin'

  const change = async () => {
    const p = await reel.app.chooseFolder()
    if (!p) return
    try {
      onInfo(await reel.app.setRoot(p))
      notify('New videos will be kept there. Your old videos stay where they were.')
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  return (
    <div className="page settings-page" ref={page}>
      <div className="page-h">
        <h1>Settings</h1>
      </div>
      <div className="settings">
        <nav className="snav" aria-label="Settings">
          {SECTIONS.map(([k, l]) => (
            <button key={k} aria-current={current === k} onClick={() => goTo(k)} data-testid={`settings-${k}`}>
              {l}
            </button>
          ))}
        </nav>
        <div>
          <section className="sblock" id="sec-ai">
            <h2>Your AI editor</h2>
            <p>It picks your best takes, adds pictures that match what you say, and changes your video from your notes.</p>
            <ConnectAI onConnected={(p) => notify(p.id === 'claude-cli' ? USING_CLAUDE_CODE : `Connected to ${p.label}.`)} />
            <Models info={info} onInfo={onInfo} onError={(m) => notify(m, 'error')} />
          </section>

          <section className="sblock" id="sec-listen">
            <h2>Listening model</h2>
            <p>Turns your voice into words, on this computer. About 500 MB, one time only.</p>
            <ModelDownload secondary />
          </section>

          <section className="sblock" id="sec-where">
            <h2>Where your videos are kept</h2>
            <div className="perm">
              <span className="ic">
                <Icon name="folder" size={16} />
              </span>
              <div>
                <b title={info.root} data-testid="root-display">
                  {info.rootDisplay}
                </b>
                <span>Your videos never leave this computer unless you send them.</span>
              </div>
              <span className="spacer" />
              <button className="btn small" onClick={() => reel.app.openFolder(info.root)}>
                Show in {FOLDER_APP}
              </button>
              <button className="btn small ghost" onClick={change}>
                Change…
              </button>
            </div>
            {perm && perm.folder !== 'allowed' && (
              <div className="row">
                <p className="perm-problem" role="alert" data-testid="folder-problem">
                  {perm.folder === 'unusable'
                    ? "I can't save in this folder. Choose another one."
                    : perm.folder === 'denied'
                      ? "Your Mac isn't letting Reel Studio use this folder. Press Allow to turn it on in System Settings."
                      : 'Press Allow so Reel Studio can use this folder.'}
                </p>
                {(perm.folder === 'denied' || perm.folder === 'not-asked') && (
                  <button className="btn small primary" disabled={pending === 'folder'} onClick={() => void request('folder', () => reel.perm.allowFolder())} data-testid="folder-allow">
                    Allow
                  </button>
                )}
              </div>
            )}
            <label className="toggle">
              <input
                type="checkbox"
                checked={info.fasterExports}
                disabled={savingExports}
                onChange={(e) => void toggleExports(e.target.checked)}
                aria-describedby="export-rate-help"
                data-testid="faster-exports"
              />
              Faster exports (30 fps)
            </label>
            <p id="export-rate-help" className="muted-sm toggle-help">
              For new videos. Leave off to keep smoother motion from 60 fps footage.
            </p>
          </section>

          <section className="sblock" id="sec-notify">
            <h2>Notifications</h2>
            {alerts === undefined || alerts === 'unsupported' ? (
              <p>This computer doesn't show notifications from Reel Studio.</p>
            ) : (
              <>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={alertsOn}
                    disabled={pending !== null && pending !== 'folder'}
                    onChange={(e) => void toggleAlerts(e.target.checked)}
                    data-testid="notifications-toggle"
                  />
                  Tell me when a video is ready
                </label>
                <p className="muted-sm toggle-help" data-testid="notifications-note">
                  {alerts === 'asking'
                    ? 'Your Mac asks in the top-right corner of the screen. Choose Allow.'
                    : alerts === 'blocked'
                      ? 'Notifications are off for Reel Studio on this computer. Turn them on in your system settings, then press Try again.'
                      : alerts === 'unverified' && isMac
                        ? "Your Mac decides whether they show. If you don't see them, turn them on in System Settings."
                        : 'So you can do other things while your video is being made.'}
                </p>
                {alerts !== 'off' && (isMac || alerts === 'asking' || alerts === 'blocked') && (
                  <div className="row toggle-help">
                    {isMac && (
                      <button className="btn small" onClick={() => void reel.perm.openSettings('notifications')} data-testid="notifications-settings">
                        Open System Settings
                      </button>
                    )}
                    {alerts === 'asking' && pending === null && (
                      <button className="btn small ghost" onClick={() => void toggleAlerts(true)}>
                        Ask again
                      </button>
                    )}
                    {alerts === 'blocked' && (
                      <button className="btn small ghost" onClick={() => void toggleAlerts(true)}>
                        Try again
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="sblock" id="sec-privacy">
            <h2>Privacy</h2>
            <Privacy info={info} onInfo={onInfo} onError={(m) => notify(m, 'error')} />
          </section>

          {info.dev && (
            <section className="sblock" id="sec-dev">
              <h2>Developer: AI provider</h2>
              <p>Shown because REELSTUDIO_DEV=1.</p>
              <DevProviders />
            </section>
          )}

          <section className="sblock" id="sec-about">
            <h2>About and updates</h2>
            <p>Reel Studio {info.version}. Free and open source (MIT). No accounts.</p>
            {update !== null && (
              <>
                <label className="toggle">
                  <input type="checkbox" checked={update.autoCheck} onChange={(e) => void toggleUpdates(e.target.checked)} data-testid="check-updates" />
                  Check for updates
                </label>
                <p className="muted-sm toggle-help">Once a day, Reel Studio asks GitHub if there is a newer version. Nothing about you or your videos is sent.</p>
              </>
            )}
            <UpdateSettingsRow />
            {info.engine.mode === 'fake' && <p className="muted-sm">Test engine in use.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
