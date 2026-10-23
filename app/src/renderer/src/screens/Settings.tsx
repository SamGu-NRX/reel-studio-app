import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppInfo, PermissionStatus } from '../../../shared/api'
import { RELEASES_REPO } from '../../../shared/config'
import { reel, userMessage } from '../api'
import type { Go, SettingsSection } from '../nav'
import { AnthropicKey, ConnectAI, DevProviders, downloadLine, useActiveEditor, useModelStatus } from '../components/connect'
import { Connections } from '../components/Connections'
import { usePermissionStatus } from '../components/permissions'
import { Button, FOLDER_APP, IS_MAC, Progress, Spinner } from '../components/ui'
import { Icon } from '../components/icons'
import { useUpdateState } from '../components/update'
import { UpdateSettingsRow, WhatsNew } from '../components/UpdateSettings'
import { useNotify } from '../App'
import { Models, Privacy } from '../components/ModelsAndPrivacy'
import { TitleBarSlot } from '../components/titlebar'
import { Disclosure } from '../components/provider-row'
import { findSettings, SECTIONS, SETTING_IDS, SETTINGS, type SectionId, type SettingId } from '../components/settings-index'
import { SearchHits, SettingRow, Switch } from '../components/settings-rows'
import '../components/settings.css'
import { StockKeys } from '../components/stock-keys'

/** Where the older section names (nav.ts) land now. */
const SECTION_OF: Record<SettingsSection, SectionId> = { ai: 'editor', listen: 'storage', where: 'storage', notify: 'notifications', privacy: 'privacy', about: 'about' }
const ADVANCED: SettingId[] = ['model-edits', 'model-checks', 'model-titles', 'own-server', 'api-key', 'stock-keys']
const REPO_FILE = (f: string): string => `https://github.com/${RELEASES_REPO}/blob/main/${f}`

export function Settings({ info, onInfo, section }: { info: AppInfo; onInfo: (i: AppInfo) => void; go?: Go; section?: SettingsSection }) {
  const notify = useNotify()
  const [query, setQuery] = useState('')
  const hits = useMemo(() => findSettings(query), [query])
  const search = useRef<HTMLInputElement>(null)
  const [current, setCurrent] = useState<SectionId>(SECTION_OF[section ?? 'ai'])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const lock = useRef(0)
  const page = useRef<HTMLDivElement>(null)
  const [active, setActive] = useActiveEditor()

  // The list of sections marks the one being read, so a long page never loses its place.
  useEffect(() => {
    if (hits) return
    const root = page.current?.closest('.main') ?? null
    const seen = new Map<Element, boolean>()
    const blocks = Array.from(page.current?.querySelectorAll('.ssec') ?? [])
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((e) => seen.set(e.target, e.isIntersecting))
        const top = blocks.find((b) => seen.get(b))
        if (top && performance.now() > lock.current) setCurrent(top.id.replace('sec-', '') as SectionId)
      },
      { root, rootMargin: '0px 0px -60% 0px' }
    )
    blocks.forEach((b) => io.observe(b))
    return () => io.disconnect()
  }, [hits])

  useEffect(() => {
    if (section && section !== 'ai') document.getElementById(`sec-${SECTION_OF[section]}`)?.scrollIntoView({ block: 'start' })
    search.current?.focus({ preventScroll: true })
  }, [section])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        search.current?.focus()
        search.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const goTo = (k: SectionId) => {
    lock.current = performance.now() + 1000
    setCurrent(k)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('kb')
    document.getElementById(`sec-${k}`)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }
  const clear = () => {
    setQuery('')
    search.current?.focus()
  }
  const shown = (id: SettingId): boolean => !hits || hits.has(id)
  const sections = (Object.keys(SECTIONS) as SectionId[]).filter((k) => !hits || SETTING_IDS.some((id) => SETTINGS[id].section === k && hits.has(id)))

  const update = useUpdateState()
  const [savingExports, setSavingExports] = useState(false)
  // Double-check each edit (main/settings.ts checkEdits): off by default, read once like the other switches
  const [checkEdits, setCheckEdits] = useState<boolean | null>(null)
  const [savingChecks, setSavingChecks] = useState(false)
  useEffect(() => {
    reel.ai.checkEdits().then(setCheckEdits).catch(() => {})
  }, [])
  const toggleCheckEdits = async () => {
    if (checkEdits === null) return
    setSavingChecks(true)
    try {
      setCheckEdits(await reel.ai.setCheckEdits(!checkEdits))
    } catch (e) {
      notify(userMessage(e), 'error')
    } finally {
      setSavingChecks(false)
    }
  }
  const toggleExports = async () => {
    setSavingExports(true)
    try {
      onInfo(await reel.app.setFasterExports(!info.fasterExports))
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
      notify('New reels are kept there. Reels you already made stay where they are.')
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  const advanced = (
    <>
      <Models info={info} onInfo={onInfo} onError={(m) => notify(m, 'error')} />
      <Connections onConnected={setActive} />
      <AnthropicKey active={active} onConnected={setActive} />
      <StockKeys />
    </>
  )

  return (
    <div className="page settings-page" ref={page}>
      <TitleBarSlot title="Settings" />
      <div className="settings">
        <nav className="snav" aria-label="Settings sections">
          {sections.map((k) => (
            <button key={k} aria-current={!hits && current === k} onClick={() => goTo(k)} data-testid={`settings-nav-${k}`}>
              {SECTIONS[k]}
            </button>
          ))}
        </nav>
        <div className="sbody">
          <div className="ssearch" role="search">
            <Icon name="search" size={16} stroke={1.75} />
            <input
              ref={search}
              type="search"
              value={query}
              placeholder="Search settings"
              aria-label="Search settings"
              aria-keyshortcuts={IS_MAC ? 'Meta+F' : 'Control+F'}
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Escape') return
                e.preventDefault()
                e.stopPropagation()
                if (query) setQuery('')
                else e.currentTarget.blur()
              }}
              data-testid="settings-search"
            />
            {query && (
              <button className="icon-btn ssearch-x" aria-label="Clear search" onClick={clear}>
                <Icon name="x" size={14} stroke={2} />
              </button>
            )}
          </div>
          <p className="sr-only" role="status">
            {hits ? (hits.size === 1 ? '1 setting matches' : hits.size ? `${hits.size} settings match` : 'No settings match') : ''}
          </p>

          <SearchHits.Provider value={hits}>
            {hits?.size === 0 && (
              <div className="snone" data-testid="settings-no-match">
                <p>No settings match “{query.trim()}”.</p>
                <Button size="small" onClick={clear}>
                  Clear search
                </Button>
              </div>
            )}

            <Section id="editor" desc="It picks your best takes, adds pictures and makes the changes in your notes.">
              {/* hidden, not unmounted: a search must not drop a check or sign-in that is under way */}
              <div className="srow picker-row" data-setting="editor" hidden={!shown('editor')}>
                <ConnectAI advanced={false} />
              </div>
              {checkEdits !== null && (
                <SettingRow
                  id="check-edits"
                  line="After each note, your editor looks at the change again and fixes what it missed. Notes take longer and use more of your AI plan."
                  control={<Switch on={checkEdits} disabled={savingChecks} labelledBy="set-check-edits" onToggle={() => void toggleCheckEdits()} testid="check-edits" />}
                />
              )}
              {hits ? (
                ADVANCED.some(shown) && advanced
              ) : (
                <Disclosure label="Advanced" hint="Models by role, your own AI server, API keys" open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)} testid="settings-advanced">
                  {advanced}
                </Disclosure>
              )}
            </Section>

            <Section id="posting">
              <SettingRow id="instagram" line="Posting from Reel Studio isn’t ready yet. Share saves your reel and sends it to your phone." control={<span className="sval">Not connected</span>} />
            </Section>

            <Section id="storage">
              <SettingRow
                id="library-folder"
                line={
                  <span className="sval-path" title={info.root} data-testid="root-display">
                    {info.rootDisplay}
                  </span>
                }
                control={
                  <span className="sctl">
                    <Button size="small" onClick={() => reel.app.openFolder(info.root)}>
                      Show in {FOLDER_APP}
                    </Button>
                    <Button size="small" kind="tertiary" onClick={() => void change()}>
                      Change…
                    </Button>
                  </span>
                }
              >
                {perm && perm.folder !== 'allowed' && (
                  <div className="srow-more row">
                    <p className="pv-note error" role="alert" data-testid="folder-problem">
                      {perm.folder === 'unusable'
                        ? "Reel Studio can't save in this folder. Choose another one."
                        : perm.folder === 'denied'
                          ? "Your Mac isn't letting Reel Studio use this folder. Press Allow to turn it on in System Settings."
                          : 'Press Allow so Reel Studio can use this folder.'}
                    </p>
                    {(perm.folder === 'denied' || perm.folder === 'not-asked') && (
                      <Button size="small" disabled={pending === 'folder'} onClick={() => void request('folder', () => reel.perm.allowFolder())} data-testid="folder-allow">
                        Allow
                      </Button>
                    )}
                  </div>
                )}
              </SettingRow>
              <ListeningModel />
              <SettingRow
                id="faster-exports"
                line="Makes new reels at 30 fps, which is quicker. Leave off to keep the smoother motion of 60 fps video."
                control={<Switch on={info.fasterExports} disabled={savingExports} labelledBy="set-faster-exports" onToggle={() => void toggleExports()} testid="faster-exports" />}
              />
            </Section>

            <Section id="notifications">
              {alerts === undefined || alerts === 'unsupported' ? (
                <SettingRow id="notifications" line="This computer doesn't show notifications from Reel Studio." />
              ) : (
                <SettingRow
                  id="notifications"
                  line={
                    <span data-testid="notifications-note">
                      {alerts === 'asking'
                        ? 'Your Mac asks in the top-right corner of the screen. Choose Allow.'
                        : alerts === 'blocked'
                          ? 'Notifications are off for Reel Studio on this computer. Turn them on in your system settings, then press Try again.'
                          : alerts === 'unverified' && isMac
                            ? "Your Mac decides whether they show. If you don't see them, turn them on in System Settings."
                            : 'One notification per reel, so you can do other things while it’s made.'}
                    </span>
                  }
                  control={
                    <Switch on={alertsOn} disabled={pending !== null && pending !== 'folder'} labelledBy="set-notifications" onToggle={() => void toggleAlerts(!alertsOn)} testid="notifications-toggle" />
                  }
                >
                  {alerts !== 'off' && (isMac || alerts === 'asking' || alerts === 'blocked') && (
                    <div className="srow-more row">
                      {isMac && (
                        <Button size="small" onClick={() => void reel.perm.openSettings('notifications')} data-testid="notifications-settings">
                          Open System Settings
                        </Button>
                      )}
                      {alerts === 'asking' && pending === null && (
                        <Button size="small" kind="tertiary" onClick={() => void toggleAlerts(true)}>
                          Ask again
                        </Button>
                      )}
                      {alerts === 'blocked' && (
                        <Button size="small" kind="tertiary" onClick={() => void toggleAlerts(true)}>
                          Try again
                        </Button>
                      )}
                    </div>
                  )}
                </SettingRow>
              )}
            </Section>

            <Section id="privacy">
              <Privacy info={info} onInfo={onInfo} onError={(m) => notify(m, 'error')} />
            </Section>

            <Section id="about">
              <SettingRow id="version" line={`Reel Studio ${info.version}. No account needed.${info.engine.mode === 'fake' ? ' Test engine in use.' : ''}`} />
              <SettingRow
                id="licence"
                line="Free and open source under the MIT licence. The parts it's built on keep their own licences."
                control={
                  <span className="sctl">
                    <a className="ext-link" href={REPO_FILE('LICENSE')} target="_blank" rel="noreferrer" data-testid="licence-link">
                      Licence <Icon name="external" size={12} stroke={2} />
                    </a>
                    <a className="ext-link" href={REPO_FILE('THIRD_PARTY.md')} target="_blank" rel="noreferrer" data-testid="notices-link">
                      Notices <Icon name="external" size={12} stroke={2} />
                    </a>
                  </span>
                }
              />
              <SettingRow
                id="updates"
                line="Once a day, Reel Studio asks GitHub for a newer version. Nothing about you or your reels is sent."
                control={update !== null && <Switch on={update.autoCheck} labelledBy="set-updates" onToggle={() => void toggleUpdates(!update.autoCheck)} testid="check-updates" />}
              >
                <UpdateSettingsRow />
              </SettingRow>
              <SettingRow id="whats-new">
                <WhatsNew />
              </SettingRow>
            </Section>

            {info.dev && !hits && (
              <section className="ssec" id="sec-dev">
                <h2>Developer: AI provider</h2>
                <p className="ssec-desc">Shown because REELSTUDIO_DEV=1.</p>
                <DevProviders />
              </section>
            )}
          </SearchHits.Provider>
        </div>
      </div>
    </div>
  )
}

/** A heading and its rows. A search that finds none of them hides the whole section, keeping its rows' state. */
function Section({ id, desc, children }: { id: SectionId; desc?: string; children: ReactNode }) {
  const hits = useContext(SearchHits)
  return (
    <section
      className="ssec"
      id={`sec-${id}`}
      aria-labelledby={`sec-${id}-h`}
      hidden={!!hits && !SETTING_IDS.some((s) => SETTINGS[s].section === id && hits.has(s))}
      data-testid={`settings-${id}`}
    >
      <h2 id={`sec-${id}-h`}>{SECTIONS[id]}</h2>
      {desc && !hits && <p className="ssec-desc">{desc}</p>}
      <div className="srows">{children}</div>
    </section>
  )
}

/** The on-device model that writes down what you say. */
function ListeningModel() {
  const { s } = useModelStatus()
  const line = 'Writes down what you say, on this computer, for subtitles and your notes. About 500 MB, once.'
  if (!s) return <SettingRow id="listening-model" line={line} control={<Spinner />} />
  const paused = !s.installed && !s.downloading && s.pct > 0 && s.pct < 100
  return (
    <SettingRow
      id="listening-model"
      line={line}
      control={
        s.installed ? (
          <span className="sval ok" data-testid="model-ready">
            <Icon name="check" size={13} stroke={2.4} />
            Ready
          </span>
        ) : s.checking ? (
          <span className="sval">Checking…</span>
        ) : s.downloading ? (
          <Button size="small" kind="tertiary" onClick={() => void reel.model.cancel()} data-testid="pause-model">
            Pause
          </Button>
        ) : (
          <Button size="small" onClick={() => void reel.model.download()} data-testid="download-model">
            {paused ? 'Keep downloading' : 'Download'}
          </Button>
        )
      }
    >
      {(s.downloading || paused || s.checking) && (
        <div className="srow-more">
          <Progress pct={s.pct} label={s.checking ? 'Checking the listening model' : 'Downloading the listening model'} />
          {!s.checking && (
            <span className="muted-sm" data-testid="model-progress">
              {downloadLine(s, s.downloading ? 'Downloading' : 'Paused at')}
            </span>
          )}
        </div>
      )}
      {s.error && (
        <p className="pv-note error" role="alert" data-testid="model-error">
          {s.error}
        </p>
      )}
      {s.installed && s.checkFailed && (
        <p className="muted-sm srow-more" data-testid="model-check-failed">
          Reel Studio couldn't work out the fastest settings for this computer, so the listening model uses its usual ones. Everything still works.
        </p>
      )}
    </SettingRow>
  )
}
