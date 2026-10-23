import { TitleBarSlot } from '../components/titlebar'
import '../components/library.css'

/** Insights (spec section 9): each posted reel's results. In the sidebar only once a reel has been posted (Sidebar.tsx). */
export function Insights() {
  return (
    <div className="page">
      <TitleBarSlot title="Insights" />
      <p className="insights-empty" data-testid="insights-empty">
        Once a reel is posted, its views, how long people watched and where they swiped away show here, next to what your editor expected.
      </p>
    </div>
  )
}
