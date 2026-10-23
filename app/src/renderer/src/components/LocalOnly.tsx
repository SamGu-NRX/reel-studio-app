import { Icon } from './icons'

/** A screen that needs the desktop app, opened in a browser: says so, and what this browser can do instead. */
export function LocalOnly({ title, what }: { title: string; what: string }) {
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <section className="panel local-only" data-testid="local-only">
        <Icon name="film" size={22} />
        <div>
          <h2>{what} works in the Reel Studio app on this computer.</h2>
          <p className="muted">In this browser you can open your reels, play every version, and send notes to your editor while you watch their progress.</p>
        </div>
      </section>
    </div>
  )
}
