import { useEffect, useRef, useState } from 'react'
import type { VersionInfo } from '../../../shared/api'
import { dayLabel } from '../../../shared/notes-log'
import { Icon } from './icons'
import { usePresence } from './motion'
import { VersionRows, type useVersionRows } from './NotesLog'

const madeAt = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * "Version 3 · Latest" beside the title. It opens the Versions sheet, which grows from it and floats over the
 * notes: every version newest first, grouped by day, each with its before → after rows, Compare and Watch it.
 * With focus on it, the left and right arrows step through versions.
 */
export function VersionPicker({
  versions,
  shown,
  changes,
  byHand,
  rows,
  onPick,
  onCompare,
  testid = 'version-switch'
}: {
  versions: VersionInfo[]
  shown: number
  changes: Map<number, string>
  byHand: Set<number>
  rows: ReturnType<typeof useVersionRows>
  onPick: (n: number) => void
  onCompare: (n: number, with_: number) => void
  testid?: string
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<number | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const sheet = useRef<HTMLDivElement>(null)
  const { mounted, leaving } = usePresence(open, 140)
  const latest = versions[versions.length - 1]
  const older = shown !== latest.n
  const at = versions.findIndex((v) => v.n === shown)
  const { want } = rows

  useEffect(() => {
    if (!open) return
    setExpanded(shown)
    want(shown)
    sheet.current?.querySelector<HTMLElement>('.vrow.cur .vr')?.focus({ preventScroll: true })
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (!sheet.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      trigger.current?.focus()
    }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open, shown, want])

  const close = (then: () => void) => {
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
    then()
  }
  const step = (by: -1 | 1) => {
    const v = versions[at + by]
    if (v) onPick(v.n)
  }

  const newest = [...versions].reverse()
  const days: { day: string; list: VersionInfo[] }[] = []
  for (const v of newest) {
    const day = dayLabel(v.createdAt, new Date())
    if (days[days.length - 1]?.day === day) days[days.length - 1].list.push(v)
    else days.push({ day, list: [v] })
  }

  return (
    <span className="vpick-wrap">
      <button
        ref={trigger}
        className={`vpick${older ? ' older' : ''}${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          step(e.key === 'ArrowLeft' ? -1 : 1)
        }}
        data-testid={testid}
      >
        Version {shown} <span className="w">{older ? 'Older' : 'Latest'}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <span className="sr-only" aria-live="polite">{`Showing Version ${shown}${older ? ', an older version' : ''}`}</span>
      {mounted && (
        <div
          ref={sheet}
          className={`pop vsheet${leaving ? ' leave' : ''}`}
          role="dialog"
          aria-label="Versions"
          inert={leaving || undefined}
          data-testid="version-menu"
        >
          <div className="vs-h">
            <b>Versions</b>
            <span className="muted-sm">{versions.length}</span>
            <span className="spacer" />
            <button className="icon-btn small" aria-label="Close" onClick={() => close(() => {})}>
              <Icon name="x" size={16} />
            </button>
          </div>
          {days.map((g) => (
            <div key={g.day}>
              <div className="vs-day">{g.day}</div>
              {g.list.map((v) => {
                const isOpen = expanded === v.n
                return (
                  <div key={v.n} className={`vrow${v.n === shown ? ' cur' : ''}${isOpen ? ' open' : ''}`} data-testid={`version-item-${v.n}`}>
                    <button
                      className="vr"
                      aria-expanded={isOpen}
                      onClick={() => {
                        if (!isOpen) want(v.n)
                        setExpanded(isOpen ? null : v.n)
                      }}
                    >
                      <span className="vnum">{v.n}</span>
                      <span className="vt">{changes.get(v.n) ?? `Version ${v.n}`}</span>
                      {byHand.has(v.n) && (
                        <span className="by">
                          <Icon name="sliders" size={12} /> by you
                        </span>
                      )}
                      <span className="tmx">{madeAt(v.createdAt)}</span>
                      <Icon name="chevron-down" size={14} className="chev" />
                    </button>
                    <div className={`acc${isOpen ? ' open' : ''}`} inert={!isOpen || undefined}>
                      <div>
                        <VersionRows rows={rows.rows.get(v.n)} />
                        <div className="dacts">
                          {v.n > versions[0].n && (
                            <button
                              className="btn small"
                              onClick={() => close(() => onCompare(v.n, versions[versions.findIndex((x) => x.n === v.n) - 1].n))}
                              data-testid={`compare-${v.n}`}
                            >
                              <Icon name="compare" size={14} /> Compare with Version {versions[versions.findIndex((x) => x.n === v.n) - 1].n}
                            </button>
                          )}
                          <button className="btn ghost small" onClick={() => close(() => onPick(v.n))} data-testid={`watch-${v.n}`}>
                            <Icon name="play" size={13} /> Watch it
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}
