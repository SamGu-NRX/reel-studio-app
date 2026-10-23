import { useEffect, useRef, useState } from 'react'
import type { ProjectSummary } from '../../../shared/api'
import { timeLeftWords } from '../../../shared/live'
import { dayLabel } from '../../../shared/notes-log'
import { reel } from '../api'
import type { Go } from '../nav'
import { Icon } from '../components/icons'
import { YourTurn } from '../components/YourTurn'
import { useNotify } from '../App'
import { newReel } from './create'
import { sawSample } from '../components/first-run/handoff'
import '../components/home.css'

type View = 'activity' | 'all'
const VIEW_KEY = 'rs.home-view'
/** "Recent" on Activity: finished reels touched in the last two weeks. */
const RECENT_DAYS = 14

/** A first cut or a new version being made: how far along, from the job's own events. */
type Live = { overall: number; left: string | null }

const needsYou = (p: ProjectSummary) => p.status === 'interrupted' || p.status === 'failed'
const making = (p: ProjectSummary) => p.status === 'working' || p.status === 'new'

export function Home({ go }: { go: Go }) {
  const notify = useNotify()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [live, setLive] = useState<Record<string, Live>>({})
  const [view, setView] = useState<View>(() => (localStorage.getItem(VIEW_KEY) === 'all' ? 'all' : 'activity'))

  const known = useRef(new Set<string>())
  useEffect(() => {
    let alive = true
    const load = () =>
      reel.projects.list().then((p) => {
        if (!alive) return
        known.current = new Set(p.map((x) => x.slug))
        setProjects(p)
      })
    void load()
    const off = reel.jobs.onEvent((e) => {
      if (e.type !== 'status' || !e.slug) return void load()
      const slug = e.slug
      setLive((m) => ({ ...m, [slug]: { overall: e.overall, left: timeLeftWords(e) } }))
      // a reel started somewhere else (a drop, a paste, a file opened with Reel Studio)
      if (!known.current.has(slug)) void load()
    })
    const offQueue = reel.queue.onChange(() => void load())
    return () => {
      alive = false
      off()
      offQueue()
    }
  }, [])

  const open = (p: ProjectSummary) => go({ name: 'reel', slug: p.slug })
  const pick = (v: View) => {
    localStorage.setItem(VIEW_KEY, v)
    setView(v)
  }

  const now = new Date()
  const list = projects ?? []
  const card = (p: ProjectSummary) => <Card key={p.slug} p={p} live={live[p.slug]} now={now} onOpen={() => open(p)} />
  const section = (title: string, items: ProjectSummary[]) =>
    items.length > 0 && (
      <section key={title} aria-label={title}>
        <h2 className="sec-h">{title}</h2>
        <div className="grid">{items.map(card)}</div>
      </section>
    )

  let body = null
  if (view === 'activity') {
    const now_ = list.filter(making)
    const needs = list.filter(needsYou)
    const recent = list.filter((p) => p.status === 'ready' && now.getTime() - new Date(p.updatedAt).getTime() < RECENT_DAYS * 86_400_000)
    // Making now and Needs you are usually one to three cards each: they share one row instead of two mostly empty ones.
    const top =
      now_.length && needs.length && now_.length + needs.length <= 5 ? (
        <div className="grid top">
          <h2 className="sec-h" style={{ gridColumn: `1 / span ${now_.length}` }}>
            Making now
          </h2>
          <h2 className="sec-h" style={{ gridColumn: `${now_.length + 1} / span ${needs.length}` }}>
            Needs you
          </h2>
          {now_.map(card)}
          {needs.map(card)}
        </div>
      ) : (
        <>
          {section('Making now', now_)}
          {section('Needs you', needs)}
        </>
      )
    body = (
      <>
        {top}
        {section('Recent', recent)}
        {!now_.length && !needs.length && !recent.length && (
          <p className="muted home-quiet">
            Nothing new in the last two weeks.{' '}
            <button className="link inline" onClick={() => pick('all')}>
              See all your videos
            </button>
          </p>
        )}
      </>
    )
  } else body = <div className="grid">{list.map(card)}</div>

  return (
    <div className="page home">
      <div className="page-h">
        <h1>Your videos</h1>
        {list.length > 0 && (
          <div className="seg2" role="radiogroup" aria-label="Show">
            {(['activity', 'all'] as const).map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                tabIndex={view === v ? 0 : -1}
                onClick={() => pick(v)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                  e.preventDefault()
                  const next = v === 'activity' ? 'all' : 'activity'
                  pick(next)
                  ;(e.currentTarget.parentElement?.querySelector(`[data-view="${next}"]`) as HTMLElement | null)?.focus()
                }}
                data-view={v}
                data-testid={`home-${v}`}
              >
                {v === 'activity' ? 'Activity' : 'All videos'}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <button className="btn primary big" onClick={() => void newReel(go, notify)} data-testid="new-video">
          <Icon name="plus" /> New video
        </button>
      </div>

      {projects &&
        projects.length === 0 &&
        (sawSample() ? (
          <YourTurn go={go} />
        ) : (
          <div className="drop tall">
            <div className="drop-icon">
              <Icon name="video" size={28} />
            </div>
            <h2>Make your first reel</h2>
            <p className="muted">Drag your video anywhere onto this window, or click New video.</p>
          </div>
        ))}
      {list.length > 0 && body}
    </div>
  )
}

/** A cover, a title on up to two lines, and one line saying what state it is in. Only a state that wants
 * something changes the picture: a corner mark, and dimming when it needs you. */
function Card({ p, live, now, onOpen }: { p: ProjectSummary; live?: Live; now: Date; onOpen: () => void }) {
  const busy = making(p)
  const first = busy && p.version === 0
  const waiting = p.waiting > 0 ? ` · ${p.waiting} ${p.waiting === 1 ? 'note' : 'notes'} waiting` : ''
  let meta: React.ReactNode
  if (busy)
    meta = (
      <>
        {first ? 'Making' : `Making Version ${p.version + 1}`}
        {live?.left ? ` · ${live.left}` : ''}
        {waiting}
      </>
    )
  else if (p.status === 'planned') meta = 'Waiting for your video'
  else if (p.status === 'interrupted') meta = <span className="amber">Paused · Resume</span>
  else if (p.status === 'failed') meta = <span className="red">Didn't finish · Try again</span>
  else
    meta = (
      <>
        {`Version ${p.version} · ${dayLabel(p.updatedAt, now)}`}
        {waiting}
      </>
    )
  const state = busy ? 'making' : p.status === 'ready' || p.status === 'planned' ? p.status : p.status === 'interrupted' ? 'paused' : 'failed'
  return (
    <button className={`hcard st-${state}`} onClick={onOpen} title={p.title} data-testid="project-card" data-state={state}>
      <span className="im">
        {p.thumbnail ? <img src={p.thumbnail} alt="" loading="lazy" decoding="async" /> : <Icon name="video" size={30} className="placeholder" />}
        {state !== 'ready' && state !== 'planned' && (
          <span className="glyph" aria-hidden>
            {state === 'making' ? <span className="spin" /> : <Icon name={state === 'paused' ? 'pause' : 'x'} size={12} stroke={2.4} />}
          </span>
        )}
        {busy && (
          <span className="pb" aria-hidden>
            <i style={{ transform: `scaleX(${Math.max(0.03, (live?.overall ?? 0) / 100)})` }} />
          </span>
        )}
      </span>
      <span className="ttl">{p.title}</span>
      <span className="cm" data-testid="card-status">
        {meta}
      </span>
    </button>
  )
}
