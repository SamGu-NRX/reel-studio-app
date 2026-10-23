import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { StyleLesson, StyleRule } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Spinner } from '../components/ui'
import { Icon } from '../components/icons'
import { TitleBarSlot } from '../components/titlebar'
import '../components/library.css'

const day = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** When and from what a rule was learned, in plain words. */
function learned(r: StyleRule): ReactNode {
  const when = day(r.createdAt)
  if (r.imported) return `Learned ${when} from ${r.imported.file}`
  if (r.source?.note) {
    return (
      <>
        Learned {when} from your note <q>{r.source.note}</q> on {r.source.title}
        {r.source.version ? `, Version ${r.source.version}` : ''}
      </>
    )
  }
  if (r.source) return `Learned ${when} from ${r.source.title}${r.source.version ? `, Version ${r.source.version}` : ''}`
  return `Added ${when}`
}

const UNDO_MS = 8000

export function MyStyle() {
  const [rules, setRules] = useState<StyleRule[] | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ rule: StyleRule; index: number } | null>(null)
  const [lesson, setLesson] = useState<(StyleLesson & { keep: boolean[] }) | null>(null)
  const [learning, setLearning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [damaged, setDamaged] = useState(false)
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  const addButton = useRef<HTMLButtonElement>(null)
  const undoTimer = useRef<number | undefined>(undefined)
  const undoButton = useRef<HTMLButtonElement>(null)
  const load = () => Promise.all([reel.style.rules().then(setRules), reel.style.damaged().then(setDamaged)])
  useEffect(() => {
    void load()
    return () => window.clearTimeout(undoTimer.current)
  }, [])

  // the removed row's Undo takes the focus its Remove button had
  useEffect(() => {
    if (removed) undoButton.current?.focus()
  }, [removed])

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
  const remove = async (r: StyleRule) => {
    const index = rules?.findIndex((x) => x.id === r.id) ?? 0
    if (!(await run(() => reel.style.remove(r.id)))) return
    window.clearTimeout(undoTimer.current)
    setRemoved({ rule: r, index })
    undoTimer.current = window.setTimeout(() => setRemoved(null), UNDO_MS)
  }
  const undo = async () => {
    if (!removed) return
    window.clearTimeout(undoTimer.current)
    if (await run(() => reel.style.restore(removed.rule.id))) setRemoved(null)
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
  const shown: (StyleRule | 'removed')[] = [...(rules ?? [])]
  if (removed) shown.splice(Math.min(removed.index, shown.length), 0, 'removed')

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
      <p className="style-intro">Your editor follows these on every reel. A note that starts with “always” adds one.</p>
      {/* the status region is there before the line is, so a screen reader announces the line when it arrives */}
      <div role="status" className="style-status">
        {damaged && (
          <p className="banner" data-testid="style-damaged">
            Your saved style file was damaged, so a new one was started. The old one is kept next to it.
          </p>
        )}
      </div>
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

      {rules && !rules.length && !removed && adding === null && (
        <div className="style-empty" data-testid="style-empty">
          <h2>No rules yet</h2>
          <p>Start a note with “always”, like “always use big subtitles”, and it is added here. Or learn from edits you made in Final Cut Pro or Premiere Pro.</p>
        </div>
      )}

      {shown.length > 0 && (
        <ul className="style-rows">
          {shown.map((r) =>
            r === 'removed' ? (
              <li key="removed" className="style-row removed" role="status">
                <span className="style-t">
                  <span>Removed “{removed!.rule.text.replace(/\.$/, '')}”.</span>
                </span>
                <button ref={undoButton} className="btn small" onClick={() => void undo()} data-testid="style-undo">
                  <Icon name="undo" size={14} />
                  Undo
                </button>
              </li>
            ) : editing?.id === r.id ? (
              <li key={r.id}>
                <form className="style-form" onSubmit={save} onKeyDown={(e) => e.key === 'Escape' && stopEditing(r.id)}>
                  <input
                    className="input"
                    value={editing.text}
                    onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                    aria-label="Rule"
                    aria-describedby={r.payload ? `edit-hint-${r.id}` : undefined}
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
                {r.payload && (
                  <p id={`edit-hint-${r.id}`} className="muted-sm style-edit-hint" data-testid="style-edit-hint">
                    If you change these words, they become a sentence the AI reads, and the app no longer makes new reels lowercase by itself.
                  </p>
                )}
              </li>
            ) : (
              <li key={r.id} className="style-row" data-testid="style-rule">
                <span className="style-t">
                  <b className={r.paused ? 'paused' : undefined}>
                    {r.text}
                    {r.paused && <span className="badge interrupted" style={{ marginLeft: 8 }}>Paused</span>}
                  </b>
                  <span>{learned(r)}</span>
                </span>
                <span className="style-acts">
                  <button
                    className="btn small ghost"
                    ref={(el) => {
                      if (el) editButtons.current.set(r.id, el)
                      else editButtons.current.delete(r.id)
                    }}
                    onClick={() => setEditing({ id: r.id, text: r.text })}
                    aria-label={`Edit "${r.text}"`}
                  >
                    Edit
                  </button>
                  <button
                    className="btn small ghost"
                    onClick={() => void run(() => reel.style.update(r.id, { paused: !r.paused }))}
                    aria-label={`${r.paused ? 'Turn back on' : 'Pause'} "${r.text}"`}
                  >
                    {r.paused ? 'Turn back on' : 'Pause'}
                  </button>
                  <button className="btn small ghost danger" onClick={() => void remove(r)} aria-label={`Remove "${r.text}"`}>
                    Remove
                  </button>
                </span>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}
