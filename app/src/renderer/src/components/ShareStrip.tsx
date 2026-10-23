/** What a Share destination is doing: working (with a percentage once there is one) or failed, with the cause. */
export type Work = { kind: 'working'; label: string; pct: number | null } | { kind: 'failed'; message: string }

/** A destination's progress strip (ux-foundation-b section 3.2): a bar, what it is doing, Cancel; or the failure in words. */
export function Strip({ work, onCancel, onRetry }: { work: Work; onCancel?: () => void; onRetry?: () => void }) {
  if (work.kind === 'failed')
    return (
      <p className="sp-fail" role="alert">
        {work.message}
        {onRetry && (
          <>
            {' '}
            <button type="button" className="link inline" onClick={onRetry}>Try again</button>
          </>
        )}
      </p>
    )
  return (
    <div className="sp-strip" role="status">
      <div className="sp-bar" aria-hidden>
        <i className={work.pct === null ? 'run' : undefined} style={work.pct === null ? undefined : { transform: `scaleX(${Math.max(0.03, work.pct / 100)})` }} />
      </div>
      <div className="sp-strip-row">
        <span className="tnum">{work.label}</span>
        {onCancel && <button type="button" className="link inline" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}
