import { TitleBarSlot } from '../components/titlebar'

/** Insights (spec section 9): each reel's results once Instagram is connected. Empty until that lands. */
export function Insights() {
  return (
    <div className="page">
      <TitleBarSlot title="Insights" />
      <p className="muted" data-testid="insights-empty">
        Connect Instagram and this shows each reel's views, average watch time and skip rate, next to what your editor expected.
      </p>
    </div>
  )
}
