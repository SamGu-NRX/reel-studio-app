import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProviderInfo } from '../../../shared/api'
import { reel } from '../api'
import type { Go, Screen } from '../nav'
import { Icon, type IconName } from './icons'
import { BrandMark, Logo } from './brand'
import { PopMenu } from './PopMenu'
import { UpdateButton } from './UpdateButton'
import { IS_MAC, MOD } from './ui'
import { byKeyboard, reducedMotion } from './motion'
import './shell.css'

const RAIL_KEY = 'rs.sidebar-rail'

const NAV: { key: 'home' | 'library' | 'style'; label: string; icon: IconName }[] = [
  { key: 'home', label: 'My videos', icon: 'film' },
  { key: 'library', label: 'Library', icon: 'folder' },
  { key: 'style', label: 'My style', icon: 'layers' }
]

export const providerName = (p: ProviderInfo | null): string | null => {
  if (!p || !p.connected || p.id === 'none') return null
  if (p.id === 'claude-cli') return 'Claude'
  return p.label
}

/**
 * The sidebar folds to a 64 px rail (Cmd/Ctrl+\, remembered). The column takes its new width at once and the
 * page slides from where it was, so nothing reflows while it moves; from the keyboard it just changes.
 */
export function useRail(): [boolean, () => void] {
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === '1')
  const toggle = useCallback(() => {
    const main = document.querySelector<HTMLElement>('.main')
    const before = main?.getBoundingClientRect().left ?? 0
    const instant = byKeyboard() || reducedMotion()
    document.documentElement.classList.toggle('rail-instant', instant)
    setRail((r) => {
      localStorage.setItem(RAIL_KEY, r ? '0' : '1')
      return !r
    })
    if (instant || !main) {
      requestAnimationFrame(() => document.documentElement.classList.remove('rail-instant'))
      return
    }
    requestAnimationFrame(() => {
      const dx = before - main.getBoundingClientRect().left
      main.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.23, 1, .32, 1)' })
    })
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggle])
  return [rail, toggle]
}

/** The top row: on a Mac the traffic lights, then the sidebar toggle and the wordmark. Windows draws its buttons on the right. */
export function TitleBar({ rail, onToggle }: { rail: boolean; onToggle: () => void }) {
  const label = rail ? 'Show the sidebar' : 'Collapse the sidebar'
  return (
    <div className="titlebar">
      <button
        className="sbt"
        onClick={onToggle}
        aria-label={label}
        title={`${label} (${MOD}\\)`}
        aria-expanded={!rail}
        aria-controls="sidebar"
        data-testid="sidebar-toggle"
      >
        <Icon name="sidebar" size={16} stroke={1.75} />
      </button>
      <div className="wordmark" aria-hidden>
        <span className="logo">
          <Logo />
        </span>
        <b>Reel</b>
        <span>Studio</span>
      </div>
    </div>
  )
}

export function Sidebar({
  section,
  go,
  provider,
  userName,
  shown
}: {
  section: string
  go: Go
  provider: ProviderInfo | null
  userName: string | null
  shown: Screen
}) {
  const [menu, setMenu] = useState(false)
  const acct = useRef<HTMLButtonElement>(null)
  const name = providerName(provider)
  const close = useCallback(() => setMenu(false), [])
  const pick = (run: () => void) => () => {
    setMenu(false)
    run()
  }
  const who = userName?.trim() || 'You'
  const mark =
    !provider || !name
      ? null
      : provider.id === 'claude-cli' || provider.id === 'claude'
        ? 'claude'
        : provider.id === 'chatgpt' || provider.id === 'codex-cli'
          ? 'openai'
          : null

  return (
    <aside className="side" id="sidebar" aria-label="Sidebar">
      <nav className="nav" aria-label="Main">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={section === n.key ? 'on' : undefined}
            aria-current={section === n.key ? 'page' : undefined}
            onClick={() => go({ name: n.key })}
            title={n.label}
            data-testid={`nav-${n.key}`}
          >
            <Icon name={n.icon} size={16} stroke={1.75} />
            <span className="lbl">{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="side-foot">
        <div className="lbl side-update">
          <UpdateButton />
        </div>
        <button
          ref={acct}
          className={`acct${menu ? ' open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`${who}, ${name ? `AI editor ${name}` : 'no AI editor'}`}
          title={provider?.id === 'claude-cli' && name ? 'AI editor: Claude (your Claude Code app)' : undefined}
          onClick={() => setMenu((m) => !m)}
          data-testid="account"
        >
          <span className="av" aria-hidden>
            {who.charAt(0).toUpperCase()}
            <span className={`st${name ? '' : ' off'}`} />
          </span>
          <span className="who lbl">
            <b>{who}</b>
            <span data-testid="ai-status">{name ? `AI editor: ${name}` : 'No AI editor'}</span>
          </span>
          <span className="lbl chev">
            <Icon name="updown" size={14} />
          </span>
        </button>
        <PopMenu
          open={menu}
          onClose={close}
          anchor={acct}
          label="Account"
          style={{ left: 12, bottom: 64, width: 252 }}
          origin="bottom left"
          testid="account-menu"
        >
          <button
            className="mi"
            role="menuitem"
            onClick={pick(() =>
              go(
                name
                  ? { name: 'settings', section: 'ai' }
                  : { name: 'connect', back: shown.name === 'connect' ? undefined : (shown as Exclude<Screen, { name: 'connect' }>) }
              )
            )}
            data-testid="sidebar-connect"
          >
            {mark ? <BrandMark name={mark} size={14} /> : <Icon name="sparkles" size={16} />}
            AI editor
            <span className="r">{name ?? 'Connect one'}</span>
          </button>
          <button className="mi" role="menuitem" onClick={pick(() => go({ name: 'settings' }))} data-testid="nav-settings">
            <Icon name="settings" size={16} />
            Settings
            <span className="r">{IS_MAC ? '⌘,' : 'Ctrl+,'}</span>
          </button>
          <hr />
          <button className="mi" role="menuitem" onClick={pick(() => void reel.update.openRelease())} data-testid="whats-new">
            <Icon name="bell" size={16} />
            What's new
          </button>
        </PopMenu>
      </div>
    </aside>
  )
}
