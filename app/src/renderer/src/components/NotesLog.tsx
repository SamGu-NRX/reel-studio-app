import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { ChatAction, NoteMoment, QueuedNote, VersionRow } from '../../../shared/api'
import { ACTION_LABELS } from '../../../shared/notes'
import { clock } from '../../../shared/progress'
import type { LogEntry, LogResult } from '../../../shared/notes-log'
import { reel, userMessage } from '../api'
import { Icon } from './icons'
import { AttachmentThumb } from './NoteAttachments'

/** "What changed" under a version: its before → after rows, read once when first opened. */
export function useVersionRows(slug: string): { rows: Map<number, VersionRow[] | null>; want: (n: number) => void } {
  const [rows, setRows] = useState(() => new Map<number, VersionRow[] | null>())
  const asked = useRef(new Set<number>())
  const want = useCallback(
    (n: number) => {
      if (asked.current.has(n)) return
      asked.current.add(n)
      reel.projects
        .versionRows(slug, n)
        .then((r) => setRows((m) => new Map(m).set(n, r)))
        .catch(() => setRows((m) => new Map(m).set(n, null)))
    },
    [slug]
  )
  return { rows, want }
}

export function VersionRows({ rows, asked }: { rows: VersionRow[] | null | undefined; asked?: ReactNode }) {
  return (
    <div className="detail">
      {asked}
      {rows?.map((r) => (
        <div className="drow" key={r.label}>
          <span>{r.label}</span>
          <span className="ba">
            {r.before && (
              <>
                <s>{r.before}</s>
                <span className="arr" aria-label="changed to">
                  →
                </span>
              </>
            )}
            <b>{r.after}</b>
          </span>
        </div>
      ))}
    </div>
  )
}

function Moment({ m }: { m: NoteMoment | null }) {
  return m ? <span className="tm">{clock(m.at)}</span> : null
}

export function NotesLog({
  slug,
  entries,
  queue,
  held,
  latest,
  shown,
  making,
  busy,
  aiOn,
  noAiCut,
  versionRows,
  onPlay,
  onAction,
  onRetry,
  onEditHand,
  onError,
  answerError
}: {
  slug: string
  entries: LogEntry[]
  queue: QueuedNote[]
  held: boolean
  latest: number
  /** the version on screen */
  shown: number | null
  /** the version being made now, if any */
  making: number | null
  busy: boolean
  aiOn: boolean
  /** the first cut was made without an AI editor: say so under it */
  noAiCut: boolean
  versionRows: ReturnType<typeof useVersionRows>
  onPlay: (n: number) => void
  onAction: (a: ChatAction, messageId: string) => void
  onRetry: (text: string, moment: NoteMoment | null) => void
  /** Opens Edit it myself on a waiting hand edit. */
  onEditHand: (id: string) => void
  onError: (message: string) => void
  /** saving a "Remember this for next time?" answer failed: the question keeps its buttons */
  answerError: { id: string; text: string } | null
}) {
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<Record<number, boolean>>({})
  const [folded, setFolded] = useState(0)
  const [unfolded, setUnfolded] = useState(false)
  const waiting = queue.filter((q) => !q.attempt)

  // The newest version shows what changed until the person folds it.
  const isOpen = (n: number) => open[n] ?? n === latest
  const latestOpen = isOpen(latest)
  const { want } = versionRows
  useEffect(() => {
    if (latestOpen && latest > 0) want(latest)
  }, [latestOpen, latest, want])

  // Older entries fold behind one line while the list is taller than its column; new ones are added at the bottom.
  const size = `${entries.length}:${waiting.length}`
  const lastSize = useRef(size)
  useLayoutEffect(() => {
    if (lastSize.current !== size) {
      lastSize.current = size
      setFolded(0)
      return
    }
    const el = box.current
    if (!el) return
    if (!unfolded && el.scrollHeight > el.clientHeight + 1 && folded < entries.length - 2) setFolded((f) => f + 1)
    else el.scrollTop = el.scrollHeight
  })

  const toggle = (n: number) => {
    const next = !isOpen(n)
    if (next) versionRows.want(n)
    setOpen((o) => ({ ...o, [n]: next }))
  }

  const result = (e: LogEntry, r: LogResult) => {
    switch (r.kind) {
      case 'version': {
        const on = isOpen(r.v)
        return (
          <>
            <div className={`nt-res${shown === r.v ? ' cur' : ''}`} data-v={r.v}>
              <span className="nk ok">
                <Icon name="check" size={12} stroke={2.4} />
              </span>
              <button className="v" onClick={() => onPlay(r.v)} aria-label={`Play Version ${r.v}`} data-testid={`log-play-${r.v}`}>
                Version {r.v}
              </button>
              <span className="t" title={r.text}>
                {r.text}
              </span>
              <button className="lk" aria-expanded={on} onClick={() => toggle(r.v)} data-testid={`what-changed-${r.v}`}>
                What changed
              </button>
              {shown === r.v && shown !== latest && <span className="onscreen">On screen</span>}
            </div>
            <div className={`acc${on ? ' open' : ''}`} inert={!on || undefined}>
              <div>
                <VersionRows
                  rows={versionRows.rows.get(r.v)}
                  asked={
                    <>
                      {r.text.length > 60 && <p className="said selectable">{r.text}</p>}
                      {e.key === 'video' && noAiCut && (
                        <p className="asked">No AI editor yet, so I made a simple cut. You can still change anything under Edit it myself.</p>
                      )}
                    </>
                  }
                />
              </div>
            </div>
          </>
        )
      }
      case 'making':
        return (
          <div className="nt-res quiet" aria-busy>
            <span className="nk">
              <span className="spin" />
            </span>
            <span className="t">Making Version {r.v}</span>
          </div>
        )
      case 'failed':
        return (
          <div className="nt-res" role="alert">
            <span className="nk err">
              <Icon name="x" size={12} stroke={2.4} />
            </span>
            <span className="t wrap">{r.text}</span>
            {e.ask.kind === 'note' && aiOn && (
              <button className="btn small" disabled={busy} onClick={() => e.ask.kind === 'note' && onRetry(e.ask.text, e.ask.moment)} data-testid="log-retry">
                <Icon name="retry" size={14} /> Try again
              </button>
            )}
          </div>
        )
      case 'stopped':
        return (
          <div className="nt-res">
            <span className="nk stop">
              <Icon name="stop" size={12} stroke={2.4} />
            </span>
            <span className="t">Stopped. {r.kept ? `Version ${r.kept} is unchanged.` : 'Nothing changed.'}</span>
            {e.ask.kind === 'note' && aiOn && (
              <button className="btn small" disabled={busy} onClick={() => e.ask.kind === 'note' && onRetry(e.ask.text, e.ask.moment)} data-testid="log-retry">
                <Icon name="retry" size={14} /> Try again
              </button>
            )}
          </div>
        )
      case 'reply':
        return <Reply text={r.text} actions={r.actions} id={r.messageId} busy={busy} onAction={onAction} />
    }
  }

  const shownEntries = unfolded ? entries : entries.slice(folded)
  return (
    <div className="log" ref={box} role="log" aria-label="Notes for your editor" data-testid="chat">
      {!unfolded && folded > 0 && (
        <button className="fold" aria-expanded={false} onClick={() => setUnfolded(true)} data-testid="log-unfold">
          <Icon name="chevron-down" size={14} />
          {folded} earlier {folded === 1 ? 'note' : 'notes'}
        </button>
      )}
      {shownEntries.map((e) => (
        <article key={e.key} className={`nt${e.ask.kind === 'note' ? ' note' : ''}`} data-testid={`log-${e.ask.kind}`}>
          {e.day && <div className="nday">{e.day}</div>}
          <div className="nt-ask">
            <span className={`nk ${e.ask.kind === 'note' ? 'dot' : 'you'}`}>
              {e.ask.kind === 'video' && <Icon name="video" size={12} stroke={2.2} />}
              {e.ask.kind === 'hand' && <Icon name="sliders" size={12} stroke={2.2} />}
            </span>
            <span className="q selectable">
              {e.ask.kind === 'note' && <Moment m={e.ask.moment} />}
              {e.ask.text}
              {e.ask.kind === 'note' && e.ask.attachments.length > 0 && (
                <span className="q-att">
                  {e.ask.attachments.map((a) => (
                    <AttachmentThumb key={a.asset} a={a} size="chip" />
                  ))}
                </span>
              )}
            </span>
          </div>
          {e.result && result(e, e.result)}
          {e.extra.map((m) => (
            <Reply
              key={m.id}
              text={m.text}
              actions={m.actions ?? []}
              id={m.id}
              busy={busy}
              onAction={onAction}
              question={!!(m.suggestion || m.proposal)}
              scope={m.proposal?.source.version}
              error={answerError?.id === m.id && m.actions?.length ? answerError.text : undefined}
            />
          ))}
        </article>
      ))}
      {waiting.map((q, i) => (
        <QueuedRow key={q.id} slug={slug} q={q} i={i} count={waiting.length} held={held} on={latest + (making ? 1 : 0) + i} onEditHand={onEditHand} onError={onError} />
      ))}
    </div>
  )
}

function Reply({
  text,
  actions,
  id,
  busy,
  onAction,
  question,
  scope,
  error
}: {
  text: string
  actions: ChatAction[]
  id: string
  busy: boolean
  onAction: (a: ChatAction, id: string) => void
  /** a "Remember this for next time?" question: focus returns here once it is answered */
  question?: boolean
  /** the version a typed My style rule comes from */
  scope?: number
  error?: string
}) {
  const shown = actions.filter((a) => a !== 'connect')
  return (
    <div className="nt-res quiet reply" id={`msg-${id}`} tabIndex={question ? -1 : undefined} data-testid="bubble-editor">
      <span className="nk" />
      <span className="t wrap selectable">
        {text}
        {scope !== undefined && (
          <span className="bubble-meta" data-testid="remember-scope">
            For new videos. From version {scope} of this video.
          </span>
        )}
        {error && (
          <span className="bubble-meta error" role="alert" data-testid="remember-error">
            {error}
          </span>
        )}
        {shown.length > 0 && (
          <span className="reply-acts">
            {shown.map((a) => (
              <button key={a} className="lk" disabled={busy} onClick={() => onAction(a, id)} data-testid={`action-${a}`}>
                {a === 'remember-yes' && error ? 'Try again' : ACTION_LABELS[a]}
              </button>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}

/** A note waiting its turn: its words can change, it can go, and with others waiting it can move (grip, or arrow keys on it). */
function QueuedRow({
  slug,
  q,
  i,
  count,
  held,
  on,
  onEditHand,
  onError
}: {
  slug: string
  q: QueuedNote
  i: number
  count: number
  held: boolean
  on: number
  onEditHand: (id: string) => void
  onError: (m: string) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const act = (p: Promise<unknown>) => void p.catch((e) => onError(userMessage(e)))
  const move = async (to: number) => {
    const by = to > i ? 1 : -1
    for (let k = i; k !== to; k += by) await reel.queue.move(slug, q.id, by)
  }
  const many = count > 1
  const save = () => {
    const t = (draft ?? '').trim()
    setDraft(null)
    if (t && t !== q.text) act(reel.queue.edit(slug, q.id, t))
  }
  return (
    <article
      className={`nt queued${over ? ' over' : ''}`}
      data-testid="queue-row"
      draggable={many && draft === null}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-rs-queue', String(i))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/x-rs-queue')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const from = Number(e.dataTransfer.getData('application/x-rs-queue'))
        if (!Number.isInteger(from) || from === i) return
        e.preventDefault()
        e.stopPropagation()
        act(
          (async () => {
            const by = i > from ? 1 : -1
            const id = (await reel.projects.get(slug)).queue.filter((x) => !x.attempt)[from]?.id
            if (!id) return
            for (let k = from; k !== i; k += by) await reel.queue.move(slug, id, by)
          })()
        )
      }}
    >
      <div className="nt-ask">
        {many ? (
          <button
            className="nk grip"
            aria-label="Move this note. Use the up and down arrow keys."
            onKeyDown={(e) => {
              if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
              e.preventDefault()
              const to = i + (e.key === 'ArrowUp' ? -1 : 1)
              if (to >= 0 && to < count) act(move(to))
            }}
            data-testid="queue-grip"
          >
            <Icon name="grip" size={14} />
          </button>
        ) : (
          <span className={`nk ${q.hand ? 'you' : 'dot'}`}>{q.hand && <Icon name="sliders" size={12} stroke={2.2} />}</span>
        )}
        {q.hand ? (
          <span className="q" data-testid="queue-hand">
            {held ? 'Held because you stopped' : `${i === 0 ? 'Next' : 'Then'}, on Version ${on}`}: your edit ({q.hand.changes} {q.hand.changes === 1 ? 'change' : 'changes'})
          </span>
        ) : draft === null ? (
          <span className="q">
            <Moment m={q.moment ?? null} />
            {q.text}
          </span>
        ) : (
          <input
            className="input q-edit"
            autoFocus
            value={draft}
            aria-label="Change this note"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setDraft(null)
            }}
            data-testid="queue-edit-input"
          />
        )}
      </div>
      <div className="nt-res quiet">
        <span className="nk" />
        <span className="t">{q.hand ? q.text.charAt(0).toUpperCase() + q.text.slice(1) : held ? 'Held because you stopped' : `${i === 0 ? 'Next' : 'Then'}, on Version ${on}`}</span>
        {draft === null && (
          <>
            <button className="btn ghost small" onClick={() => (q.hand ? onEditHand(q.id) : setDraft(q.text))} data-testid="queue-edit">
              Edit
            </button>
            <button className="btn ghost small" onClick={() => act(reel.queue.cancel(slug, q.id))} data-testid="queue-cancel">
              Cancel
            </button>
          </>
        )}
      </div>
    </article>
  )
}
