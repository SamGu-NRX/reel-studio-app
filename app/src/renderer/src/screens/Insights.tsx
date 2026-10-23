import { useEffect, useState } from 'react'
import { DEMO_HANDLE, type ProjectSummary } from '../../../shared/api'
import { dayLabel } from '../../../shared/notes-log'
import { reel } from '../api'
import { TitleBarSlot } from '../components/titlebar'
import '../components/library.css'

/** A number from the slug, the same on every render: each demo reel keeps its own audience. */
function seed(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0) / 4294967295
}

/** Demo numbers that grow after posting (about half the reel's audience in its first hour), never real data. */
function demoMetrics(p: ProjectSummary, now: number) {
  const r = seed(p.slug)
  const at = Date.parse(p.review.at ?? p.updatedAt)
  const minutes = Math.max(0, (now - at) / 60000)
  const peak = 18000 + r * 42000
  const views = Math.round(peak * (1 - Math.exp(-(minutes + 4) / 90)))
  return {
    views,
    watched: Math.round(58 + r * 27),
    likes: Math.round(views * (0.06 + r * 0.04)),
    comments: Math.round(views * (0.004 + r * 0.004)),
    shares: Math.round(views * (0.01 + r * 0.012))
  }
}

const compact = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString())

/** Insights (spec section 9): each posted reel's results. In the sidebar only once a reel has been posted (Sidebar.tsx). */
export function Insights() {
  const [reels, setReels] = useState<ProjectSummary[] | null>(null)
  const [demo, setDemo] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    void reel.app.info().then((i) => setDemo(i.demo))
    void reel.projects.list().then((all) => setReels(all.filter((p) => p.posted)))
    const t = window.setInterval(() => setNow(Date.now()), 5000)
    return () => window.clearInterval(t)
  }, [])

  if (!demo || !reels?.length)
    return (
      <div className="page">
        <TitleBarSlot title="Insights" />
        <p className="insights-empty" data-testid="insights-empty">
          Once a reel is posted, its views, how long people watched and where they swiped away show here, next to what your editor expected.
        </p>
      </div>
    )

  const rows = reels.map((p) => ({ p, m: demoMetrics(p, now) })).sort((a, b) => b.m.views - a.m.views)
  const total = (k: 'views' | 'likes' | 'shares') => rows.reduce((n, r) => n + r.m[k], 0)
  const watched = Math.round(rows.reduce((n, r) => n + r.m.watched, 0) / rows.length)
  return (
    <div className="page" data-testid="insights">
      <TitleBarSlot
        title={
          <>
            <h1 className="tb-h">Insights</h1>
            <span className="rt-ver">@{DEMO_HANDLE} · Demo account</span>
          </>
        }
      />
      <div className="ins-totals">
        <Stat n={compact(total('views'))} label="Views" />
        <Stat n={`${watched}%`} label="Watched on average" />
        <Stat n={compact(total('likes'))} label="Likes" />
        <Stat n={compact(total('shares'))} label="Shares" />
      </div>
      <ul className="ins-list">
        {rows.map(({ p, m }) => (
          <li key={p.slug} className="ins-row">
            <span className="ins-im">{p.thumbnail && <img src={p.thumbnail} alt="" />}</span>
            <span className="ins-t">
              <b>{p.title}</b>
              <span className="faint">Posted {dayLabel(p.review.at ?? p.updatedAt, new Date(now)).toLowerCase()}</span>
            </span>
            <span className="ins-n tnum">{compact(m.views)}<small>views</small></span>
            <span className="ins-n tnum">{m.watched}%<small>watched</small></span>
            <span className="ins-n tnum">{compact(m.likes)}<small>likes</small></span>
            <span className="ins-n tnum">{compact(m.comments)}<small>comments</small></span>
            <span className="ins-n tnum">{compact(m.shares)}<small>shares</small></span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="ins-stat">
      <b className="tnum">{n}</b>
      <span className="faint">{label}</span>
    </div>
  )
}
