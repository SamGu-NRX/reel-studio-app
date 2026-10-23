import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { StyleLesson, StyleRule } from '../../../shared/api'
import { classifyKind, KIND_NAME, newestFirst, shortLine, sourceDetail, sourceLine, type MemoryKind } from '../../../shared/memory'
import { reel, userMessage } from '../api'
import { Spinner } from '../components/ui'
import { Icon, type IconName } from '../components/icons'
import { reducedMotion } from '../components/motion'
import { TitleBarSlot } from '../components/titlebar'
import '../components/library.css'

const KIND_ICON: Record<MemoryKind, IconName> = { captions: 'type', pacing: 'timer', music: 'music', cuts: 'scissors', look: 'aperture' }

const UNDO_MS = 8000
const EASE = 'cubic-bezier(.2, .8, .2, 1)'

/** What the open line says under the full sentence: who uses the rule, or that nobody does while it is paused. */
function usedBy(r: StyleRule): string {
  if (r.paused) return 'Paused. Not used on new reels until you resume it.'
  return r.payload ? 'The app sets this on every new reel.' : 'Your editor reads this on every new reel.'
}

const exact = (iso: string | undefined): string | null => {
  const t = Date.parse(iso ?? '')
  return Number.isNaN(t) ? null : new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** The open line's "which note, and when": the note or files, then the exact time it was saved and last edited. */
function learnedWhen(r: StyleRule): string | null {
  const saved = exact(r.createdAt)
  const edited = exact(r.updatedAt)
  const parts = [sourceDetail(r), saved && `${r.byYou ? 'Added' : 'Saved'} ${saved}`, edited && `edited ${edited}`]
  return parts.filter(Boolean).join(' · ') || null
}

/** My style: every saved rule as one short line, newest first. */
export function MyStyle() {
  const [rules, setRules] = useState<StyleRule[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [forgot, setForgot] = useState<{ rule: StyleRule; at: number } | null>(null)
  const [refocus, setRefocus] = useState<string | null>(null)
  const [lesson, setLesson] = useState<(StyleLesson & { keep: boolean[] }) | null>(null)
  const [learning, setLearning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const forgetButtons = useRef(new Map<string, HTMLButtonElement>())
  const addButton = useRef<HTMLButtonElement>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const undoButton = useRef<HTMLButtonElement>(null)
  const forgotRow = useRef<HTMLLIElement>(null)
  const collapse = useRef<Animation | null>(null)
  const list = useRef<HTMLUListElement>(null)
  const load = () => reel.style.rules().then(setRules)
  useEffect(() => {
    void load()
    return () => window.clearTimeout(undoTimer.current)
  }, [])

  // the forgotten row's Undo takes the focus its Forget button had, and Undo gives it back
  useEffect(() => {
    if (forgot) undoButton.current?.focus()
  }, [forgot])
  useEffect(() => {
    const el = refocus && forgetButtons.current.get(refocus)
    if (!el) return
    el.focus()
    setRefocus(null)
  }, [refocus, rules])

  const run = async (change: () => Promise<unknown>): Promise<boolean> => {
    setError(null)
    try {
      await change()
      await load()
      return true
    } catch (e) {
      setError(userMessage(e))
      return false
    }
  }
  const stopEditing = (id: string) => {
    setEditing(null)
    requestAnimationFrame(() => editButtons.current.get(id)?.focus())
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const { id, text } = editing
    if (await run(() => reel.style.update(id, { text }))) stopEditing(id)
  }
  const addRule = async (e: FormEvent) => {
    e.preventDefault()
    if (!adding?.trim()) return
    if (await run(() => reel.style.add(adding))) setAdding(null)
  }
  const settle = () => {
    window.clearTimeout(undoTimer.current)
    collapse.current?.cancel()
    collapse.current = null
  }
  // When Undo runs out, its line folds away instead of the rows below jumping up. If Undo had the focus, the
  // row that takes its place gets it, so the keyboard is not sent back to the top of the window.
  const lapse = () => {
    const el = forgotRow.current
    const gone = () => {
      const hadFocus = !!el?.contains(document.activeElement)
      const at = el ? Array.from(list.current?.children ?? []).indexOf(el) : -1
      setForgot(null)
      if (hadFocus)
        requestAnimationFrame(() => {
          const rows = list.current?.querySelectorAll<HTMLButtonElement>('.mem-line')
          ;(rows?.[Math.min(at, rows.length - 1)] ?? addButton.current)?.focus()
        })
    }
    if (!el) return gone()
    const frames = reducedMotion() ? [{ opacity: 1 }, { opacity: 0 }] : [{ height: `${el.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }]
    collapse.current = el.animate(frames, { duration: 200, easing: reducedMotion() ? 'ease' : EASE, fill: 'forwards' })
    collapse.current.finished.then(gone, () => undefined)
  }
  const forget = async (r: StyleRule, at: number) => {
    if (!(await run(() => reel.style.remove(r.id)))) return
    settle()
    if (open === r.id) setOpen(null)
    setForgot({ rule: r, at })
    undoTimer.current = window.setTimeout(lapse, UNDO_MS)
  }
  const undo = async () => {
    if (!forgot) return
    settle()
    const id = forgot.rule.id
    if (await run(() => reel.style.restore(id))) {
      setForgot(null)
      setRefocus(id)
    }
  }
  const learn = async () => {
    setError(null)
    setLearning(true)
    try {
      const l = await reel.style.learn()
      if (l) setLesson({ ...l, keep: l.rules.map(() => true) })
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setLearning(false)
    }
  }
  const closeAdding = () => {
    setAdding(null)
    addButton.current?.focus()
  }
  const keep = async () => {
    if (!lesson) return
    const chosen = lesson.rules.filter((_, i) => lesson.keep[i])
    if (await run(() => reel.style.keepLearned(chosen, lesson.files.map((f) => f.name).join(', ')))) setLesson(null)
  }

  const kept = lesson?.keep.filter(Boolean).length ?? 0
  const now = Date.now()
  const shown: (StyleRule | 'forgot')[] = newestFirst(rules ?? [])
  if (forgot) shown.splice(Math.min(forgot.at, shown.length), 0, 'forgot')

  return (
    <div className="page style-page">
      <TitleBarSlot
        title="My style"
        actions={
          <>
            <button className="btn" onClick={() => void learn()} disabled={learning} data-testid="style-learn">
              {learning && <Spinner />}
              {learning ? 'Reading your edits' : 'Learn from my past edits'}
            </button>
            <button
              ref={addButton}
              className={lesson ? 'btn' : 'btn primary'}
              onClick={() => setAdding((a) => a ?? '')}
              data-testid="style-add"
            >
              <Icon name="plus" />
              Add a rule
            </button>
          </>
        }
      />
      {shown.length > 0 && (
        <p className="style-intro">Your editor follows these on every new reel, newest first. A note that starts with “always” can add one.</p>
      )}
      {error && (
        <p className="style-note" role="alert">
          {error}
        </p>
      )}

      {lesson && (
        <section className="lesson" aria-labelledby="lesson-h" data-testid="style-lesson">
          <div className="lesson-h">
            <b id="lesson-h">
              {lesson.rules.length ? 'What your past edits show' : 'Nothing stood out in these edits'}
            </b>
            <span>
              {lesson.files.map((f) => `${f.name} (${f.editor})`).join(', ') || 'No export could be read'}
              {lesson.timelines ? ` · ${lesson.timelines} timeline${lesson.timelines === 1 ? '' : 's'}, ${lesson.shots} shots` : ''}. Nothing is
              saved until you keep it.
            </span>
          </div>
          {lesson.rules.length > 0 && (
            <ul className="lesson-rules">
              {lesson.rules.map((r, i) => (
                <li key={r.text}>
                  <label className="lesson-rule" data-testid="style-lesson-rule">
                    <input
                      type="checkbox"
                      checked={lesson.keep[i]}
                      onChange={(e) => setLesson({ ...lesson, keep: lesson.keep.map((k, j) => (j === i ? e.target.checked : k)) })}
                    />
                    <span className="style-t">
                      <b>{r.text}</b>
                      <span>{r.evidence}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {lesson.skipped.map((s) => (
            <p key={s.name} className="lesson-skip">
              {s.name}: {s.reason}
            </p>
          ))}
          <div className="lesson-foot">
            {lesson.rules.length > 0 && (
              <button className="btn primary" onClick={() => void keep()} disabled={!kept} data-testid="style-lesson-keep">
                {kept === 1 ? 'Keep 1 rule' : `Keep ${kept} rules`}
              </button>
            )}
            <button className="btn ghost" onClick={() => setLesson(null)}>
              {lesson.rules.length ? 'Cancel' : 'Close'}
            </button>
          </div>
        </section>
      )}

      {adding !== null && (
        <form className="style-form" onSubmit={addRule} onKeyDown={(e) => e.key === 'Escape' && closeAdding()}>
          <input
            className="input"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            placeholder="Always use big subtitles"
            aria-label="New rule"
            autoFocus
            data-testid="style-add-input"
          />
          <button className="btn small" type="submit" disabled={!adding.trim()}>
            Save
          </button>
          <button className="btn small ghost" type="button" onClick={closeAdding}>
            Cancel
          </button>
        </form>
      )}

      {rules && !rules.length && !forgot && adding === null && (
        <div className="style-empty" data-testid="style-empty">
          <h2>Nothing learned yet</h2>
          <p>
            Start a note with “always”, like “always use big subtitles”, and say Yes when you’re asked to remember it. Or learn from
            edits you made in Final Cut Pro or Premiere Pro.
          </p>
        </div>
      )}

      {shown.length > 0 && (
        <ul ref={list} className="mem-rows">
          {shown.map((r, at) => {
            if (r === 'forgot') {
              return (
                <li key="forgot" ref={forgotRow} className="mem forgot" role="status">
                  <span className="mem-said">Forgot “{shortLine(forgot!.rule.text)}”.</span>
                  <button ref={undoButton} className="btn small" onClick={() => void undo()} data-testid="style-undo">
                    <Icon name="undo" size={14} />
                    Undo
                  </button>
                </li>
              )
            }
            if (editing?.id === r.id) {
              return (
                <li key={r.id}>
                  <form className="style-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && stopEditing(r.id)}>
                    <input
                      className="input"
                      value={editing.text}
                      onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                      aria-label="Rule"
                      autoFocus
                      data-testid="style-edit-input"
                    />
                    <button className="btn small" type="submit" disabled={!editing.text.trim()}>
                      Save
                    </button>
                    <button className="btn small ghost" type="button" onClick={() => stopEditing(r.id)}>
                      Cancel
                    </button>
                  </form>
                </li>
              )
            }
            const kind = classifyKind(r.text)
            const line = shortLine(r.text)
            const isOpen = open === r.id
            const from = isOpen ? learnedWhen(r) : null
            // the forgotten row sits among these, so a rule's place is counted without it
            const place = forgot && at > forgot.at ? at - 1 : at
            return (
              <li key={r.id} className={`mem${r.paused ? ' paused' : ''}${isOpen ? ' open' : ''}`} data-testid="style-rule">
                <span className="mem-kind">{kind && <Icon name={KIND_ICON[kind]} size={16} />}</span>
                <button
                  className="mem-line"
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? `mem-more-${r.id}` : undefined}
                  onClick={() => setOpen(isOpen ? null : r.id)}
                >
                  {kind && <span className="sr-only">{KIND_NAME[kind]}: </span>}
                  {line}
                </button>
                <span className="mem-state">{r.paused && 'Paused'}</span>
                <span className="mem-acts">
                  <button
                    className="btn small ghost"
                    onClick={() => void run(() => reel.style.update(r.id, { paused: !r.paused }))}
                    aria-label={`${r.paused ? 'Resume' : 'Pause'} "${line}"`}
                  >
                    {r.paused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="btn small ghost"
                    ref={(el) => {
                      if (el) forgetButtons.current.set(r.id, el)
                      else forgetButtons.current.delete(r.id)
                    }}
                    onClick={() => void forget(r, place)}
                    aria-label={`Forget "${line}"`}
                  >
                    Forget
                  </button>
                </span>
                <span className="mem-src">{sourceLine(r, now)}</span>
                {isOpen && (
                  <div className="mem-more" id={`mem-more-${r.id}`}>
                    <p className="mem-full">“{r.text}”</p>
                    {from && <p className="mem-from">{from}</p>}
                    <p className="mem-use">
                      {usedBy(r)}
                      <button
                        className="btn small ghost"
                        ref={(el) => {
                          if (el) editButtons.current.set(r.id, el)
                          else editButtons.current.delete(r.id)
                        }}
                        onClick={() => setEditing({ id: r.id, text: r.text })}
                        aria-label={`Edit "${line}"`}
                      >
                        <Icon name="pencil" size={13} />
                        Edit
                      </button>
                    </p>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
