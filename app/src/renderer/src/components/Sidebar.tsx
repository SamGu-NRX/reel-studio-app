import { useCallback, useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ProviderInfo } from '../../../shared/api'
import type { Go } from '../nav'
import { reel } from '../api'
import { Icon, type IconName } from './icons'
import { UpdateButton } from './UpdateButton'
import { byKeyboard, reducedMotion } from './motion'
import { SIDE, sideWidth } from './side-width'
import { IS_MAC } from './ui'
import './shell.css'

const RAIL_KEY = 'rs.sidebar-rail'
const WIDTH_KEY = 'rs.sidebar-width'
const RAIL_W = 64

const NAV: { key: 'home' | 'library' | 'style' | 'insights'; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Reels', icon: 'film' },
  { key: 'library', label: 'Library', icon: 'folder' },
  { key: 'style', label: 'My style', icon: 'layers' },
  { key: 'insights', label: 'Insights', icon: 'chart' }
]

export const providerName = (p: ProviderInfo | null): string | null => {
  if (!p || !p.connected || p.id === 'none') return null
  if (p.id === 'claude-cli') return 'Claude'
  return p.label
}

/**
 * The sidebar folds to a 64 px rail (Cmd/Ctrl+\, remembered). The column takes its new width at once and the
 * page and the title row slide from where they were, so nothing reflows while it moves; from the keyboard it just changes.
 */
export function useRail(): [boolean, (byShortcut?: boolean) => void] {
  const [rail, setRail] = useState(() => localStorage.getItem(RAIL_KEY) === '1')
  // byKeyboard() does not count Cmd/Ctrl shortcuts (motion.ts), so the shortcut says so itself
  const toggle = useCallback((byShortcut = false) => {
    const moving = Array.from(document.querySelectorAll<HTMLElement>('.main, .tb-main'))
    const before = moving.map((el) => el.getBoundingClientRect().left)
    const instant = byShortcut || byKeyboard() || reducedMotion()
    document.documentElement.classList.toggle('rail-instant', instant)
    setRail((r) => {
      localStorage.setItem(RAIL_KEY, r ? '0' : '1')
      return !r
    })
    if (instant) {
      requestAnimationFrame(() => document.documentElement.classList.remove('rail-instant'))
      return
    }
    requestAnimationFrame(() =>
      moving.forEach((el, i) => {
        const dx = before[i] - el.getBoundingClientRect().left
        el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 200, easing: 'cubic-bezier(.23, 1, .32, 1)' })
      })
    )
  }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        toggle(true)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [toggle])
  return [rail, toggle]
}

/** The open width lives in CSS (--side-open, and the rail's scale of it), so a drag restyles without re-rendering the app. */
function applyWidth(w: number): void {
  const root = document.documentElement.style
  root.setProperty('--side-open', `${w}px`)
  root.setProperty('--rail-scale', String(RAIL_W / w))
}

/** Drag the sidebar's edge (or use the arrow keys on it) between 232 and 360 px; a double-click goes back to 248. */
function SideResizer() {
  const [width, setWidth] = useState(() => sideWidth(localStorage.getItem(WIDTH_KEY)))
  useEffect(() => applyWidth(width), [width])
  const commit = (w: number) => {
    setWidth(w)
    localStorage.setItem(WIDTH_KEY, String(w))
  }
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const x0 = e.clientX
    const w0 = width
    document.documentElement.classList.add('side-resizing')
    const move = (m: PointerEvent) => setWidth(sideWidth(w0 + m.clientX - x0))
    // A released drag keeps its width; a cancelled one (capture lost, the system took the pointer) goes back.
    const end = (e: PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
      el.removeEventListener('lostpointercapture', end)
      document.documentElement.classList.remove('side-resizing')
      if (e.type === 'pointerup') commit(sideWidth(w0 + e.clientX - x0))
      else setWidth(w0)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('lostpointercapture', end)
  }
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' ? -8 : e.key === 'ArrowRight' ? 8 : 0
    if (e.key === 'Home') commit(SIDE.min)
    else if (e.key === 'End') commit(SIDE.max)
    else if (step) commit(sideWidth(width + step))
    else return
    e.preventDefault()
  }
  return (
    <div
      className="side-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      aria-valuenow={width}
      aria-valuemin={SIDE.min}
      aria-valuemax={SIDE.max}
      tabIndex={0}
      onPointerDown={down}
      onKeyDown={key}
      onDoubleClick={() => commit(SIDE.default)}
      data-testid="sidebar-resize"
    />
  )
}

/** Insights joins the sidebar once a reel has been posted (ux-foundation-b.md section 6). Read again on every screen change. */
function usePosted(section: string): boolean {
  const [posted, setPosted] = useState(false)
  useEffect(() => {
    reel.projects.list().then((reels) => setPosted(reels.some((r) => r.posted)), () => {})
  }, [section])
  return posted
}

export function Sidebar({
  section,
  go,
  provider,
  userName,
  onNewReel
}: {
  section: string
  go: Go
  provider: ProviderInfo | null
  userName: string | null
  onNewReel: () => void
}) {
  const posted = usePosted(section)
  const name = providerName(provider)
  const who = userName?.trim() || 'You'
  const inSettings = section === 'settings'
  return (
    <aside className="side" id="sidebar" aria-label="Sidebar">
      <nav className="nav" aria-label="Main">
        <button
          className="new-reel"
          onClick={onNewReel}
          title={`New reel (${IS_MAC ? '⌘N' : 'Ctrl+N'})`}
          aria-keyshortcuts={IS_MAC ? 'Meta+N' : 'Control+N'}
          data-testid="new-reel"
        >
          <Icon name="plus" size={16} stroke={1.75} />
          <span className="lbl">New reel</span>
        </button>
        {NAV.filter((n) => n.key !== 'insights' || posted).map((n) => (
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
          className={`acct${inSettings ? ' on' : ''}`}
          aria-current={inSettings ? 'page' : undefined}
          aria-label={`${who}, ${name ? `AI editor ${name}` : 'no AI editor'}. Settings`}
          title={provider?.id === 'claude-cli' && name ? 'AI editor: Claude (your Claude Code app). Settings' : 'Settings'}
          onClick={() => go({ name: 'settings' })}
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
        </button>
      </div>
      <SideResizer />
    </aside>
  )
}
