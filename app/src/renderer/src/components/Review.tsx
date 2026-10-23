import { useEffect, useRef, useState } from 'react'
import type { Review, ReviewStatus } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { useNotify } from '../App'
import { Icon } from './icons'
import { usePresence } from './motion'
import { Button } from './ui'
import './review.css'

export const REVIEW_WORDS: Record<ReviewStatus, string> = {
  draft: 'Draft',
  waiting: 'Waiting for approval',
  approved: 'Approved',
  changes: 'Changes requested',
  posted: 'Posted'
}

/** The status as the app shows every status: a dot and a word. */
export function ReviewBadge({ review, className }: { review: Review; className?: string }) {
  return (
    <span className={`rv-badge rv-${review.status}${className ? ` ${className}` : ''}`} title={review.note ? `“${review.note}”` : undefined} data-testid="review-badge">
      {REVIEW_WORDS[review.status]}
    </span>
  )
}

/**
 * The Reel screen's sign-off: the status, and the one or two steps that move it on. Draft and Changes requested send it
 * for approval; Waiting offers Approve and Request changes (with a note). Approved and Posted only show where it is.
 */
export function ReviewControls({ slug, review, onChange }: { slug: string; review: Review; onChange: (r: Review) => void }) {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const set = async (status: ReviewStatus, note?: string) => {
    setBusy(true)
    try {
      const next = await reel.projects.setReview(slug, status, note)
      onChange(next)
      setAsking(false)
      notify(status === 'waiting' ? 'Sent for approval.' : status === 'approved' ? 'Approved. Ready to post.' : 'Changes requested.')
    } catch (e) {
      notify(userMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const s = review.status
  return (
    <span className="rv-ctl" data-testid="review">
      {s !== 'draft' && <ReviewBadge review={review} />}
      {(s === 'draft' || s === 'changes') && (
        <Button size="small" disabled={busy} onClick={() => void set('waiting')} data-testid="review-send">
          <Icon name="send" size={14} stroke={2} /> Send for approval
        </Button>
      )}
      {s === 'waiting' && (
        <>
          <span className="rv-anchor">
            <Button kind="tertiary" size="small" disabled={busy} aria-expanded={asking} onClick={() => setAsking((a) => !a)} data-testid="review-changes">
              Request changes
            </Button>
            <ChangesPop open={asking} busy={busy} onCancel={() => setAsking(false)} onSend={(note) => void set('changes', note)} />
          </span>
          <Button size="small" disabled={busy} onClick={() => void set('approved')} data-testid="review-approve">
            <Icon name="check" size={14} stroke={2} /> Approve
          </Button>
        </>
      )}
    </span>
  )
}

function ChangesPop({ open, busy, onCancel, onSend }: { open: boolean; busy: boolean; onCancel: () => void; onSend: (note: string) => void }) {
  const { mounted, leaving } = usePresence(open, 120)
  const [note, setNote] = useState('')
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    box.current?.querySelector('textarea')?.focus()
    const away = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.current?.parentElement?.contains(t)) onCancel()
    }
    window.addEventListener('pointerdown', away, true)
    return () => window.removeEventListener('pointerdown', away, true)
  }, [open, onCancel])
  if (!mounted) return null
  return (
    <div
      ref={box}
      className={`pop rv-pop${leaving ? ' leave' : ''}`}
      role="dialog"
      aria-label="Request changes"
      style={{ '--o': 'top right' } as React.CSSProperties}
      onKeyDown={(e) => {
        if (e.key === 'Escape') (e.stopPropagation(), onCancel())
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSend(note)
      }}
      inert={leaving || undefined}
    >
      <label className="rv-pop-h" htmlFor="rv-note">
        What should change? <span className="faint">Optional</span>
      </label>
      <textarea id="rv-note" className="textarea rv-note" rows={3} value={note} maxLength={500} placeholder="Trim the intro, the goal comes too late" onChange={(e) => setNote(e.target.value)} />
      <div className="rv-pop-foot">
        <Button kind="tertiary" size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" size="small" disabled={busy} onClick={() => onSend(note)} data-testid="review-changes-send">
          Request changes
        </Button>
      </div>
    </div>
  )
}
