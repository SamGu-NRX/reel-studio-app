// The reel's Plan card (a hook to pick, the beats, the shots: a checklist to film from) and the plain form that makes
// one when no editor is connected. Both save through projects.setPlan; shared/plan.ts checks the shape in main.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PhoneShare, PlanLine, ReelPlan } from '../../../shared/api'
import { PLAN_MAX, pickedHook, planCounts, planText } from '../../../shared/plan'
import { reel, userMessage } from '../api'
import { Icon } from './icons'
import { Qr } from './SendToPhone'
import { Spinner } from './ui'
import './plan.css'

type Kind = 'beats' | 'shots'

/**
 * The plan to film from. While the reel waits for its video every line edits in place (Enter keeps it, Escape puts it
 * back, emptying a line takes it out), the picked hook leads, and beats and shots tick off. Once the video is in, it
 * folds to one line above it and opens read-only. Copy and Send to my phone work in both.
 */
export function PlanCard({
  slug,
  title,
  plan,
  folded,
  busy,
  onSaved,
  onCopy,
  onError
}: {
  slug: string
  title: string
  plan: ReelPlan
  /** the reel has its video: one line that opens */
  folded: boolean
  /** the editor is answering: nothing changes under it */
  busy: boolean
  onSaved: () => void
  onCopy: (text: string) => void
  onError: (message: string) => void
}) {
  const [cur, setCur] = useState(plan)
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState(false)
  const phoneBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => setCur(plan), [plan])
  const readOnly = folded || busy

  const save = (next: ReelPlan): void => {
    setCur(next)
    reel.projects.setPlan(slug, next).then(onSaved, (e) => {
      setCur(plan)
      onError(userMessage(e))
    })
  }
  /** An emptied line goes, unless it is the last hook or the last beat: then it stays as it was. */
  const setHook = (i: number, text: string): boolean => {
    if (!text && cur.hooks.length < 2) return false
    const hooks = text ? cur.hooks.map((h, k) => (k === i ? text : h)) : cur.hooks.filter((_, k) => k !== i)
    const hook = text || i > cur.hook ? cur.hook : i === cur.hook ? 0 : cur.hook - 1
    save({ ...cur, hooks, hook })
    return true
  }
  const setLine = (kind: Kind, i: number, text: string): boolean => {
    const list = cur[kind]
    if (!text && kind === 'beats' && list.length < 2) return false
    save({ ...cur, [kind]: text ? list.map((l, k) => (k === i ? { ...l, text } : l)) : list.filter((_, k) => k !== i) })
    return true
  }
  const tick = (kind: Kind, i: number): void => save({ ...cur, [kind]: cur[kind].map((l, k): PlanLine => (k === i ? { text: l.text, ...(l.done ? {} : { done: true }) } : l)) })

  const actions = (
    <span className="pl-acts">
      <button className="lk" onClick={() => onCopy(planText(cur, title))} data-testid="plan-copy">
        <Icon name="copy" size={14} /> Copy
      </button>
      <button ref={phoneBtn} className="lk" aria-expanded={phone} onClick={() => setPhone((p) => !p)} data-testid="plan-phone">
        <Icon name="phone" size={14} /> Send to my phone
      </button>
    </span>
  )

  const body = (
    <>
      {phone && (
        <PlanPhone
          slug={slug}
          onDone={() => {
            setPhone(false)
            phoneBtn.current?.focus()
          }}
        />
      )}
      <section className="pl-sec" aria-label="Hook">
        <h4>{cur.hooks.length > 1 ? 'Pick a hook' : 'Hook'}</h4>
        <div role="radiogroup" aria-label="Hook" className="pl-hooks">
          {cur.hooks.map((h, i) => (
            <div key={i} className={`pl-row pl-hook${i === cur.hook ? ' on' : ''}`}>
              {cur.hooks.length > 1 && (
                <label className="pl-pick">
                  <input
                    type="radio"
                    name={`hook-${slug}`}
                    checked={i === cur.hook}
                    disabled={readOnly}
                    onChange={() => save({ ...cur, hook: i })}
                    aria-label={`Use hook ${i + 1}`}
                    data-testid={`plan-hook-${i}`}
                  />
                  <span aria-hidden />
                </label>
              )}
              <PlanField value={h} label={`Hook ${i + 1}`} readOnly={readOnly} onCommit={(t) => setHook(i, t)} />
            </div>
          ))}
        </div>
      </section>
      <Lines kind="beats" title="Beats" lines={cur.beats} readOnly={readOnly} numbered onTick={tick} onCommit={setLine} />
      {cur.shots.length > 0 && <Lines kind="shots" title="Shots" lines={cur.shots} readOnly={readOnly} onTick={tick} onCommit={setLine} />}
    </>
  )

  if (folded)
    return (
      <div className="plan folded" data-testid="plan-card" data-folded>
        <div className="pl-head">
          <button className="pl-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="plan-unfold">
            <Icon name="chevron-down" size={14} className={open ? 'open' : undefined} />
            <b>Plan</b>
            <span className="pl-fold-hook">{pickedHook(cur)}</span>
          </button>
          {!open && <span className="pl-n">{planCounts(cur)}</span>}
        </div>
        <div className={`acc${open ? ' open' : ''}`} inert={!open || undefined}>
          <div>
            <div className="pl-body">
              {actions}
              {body}
            </div>
          </div>
        </div>
      </div>
    )
  return (
    <div className="plan" data-testid="plan-card" aria-busy={busy || undefined}>
      <div className="pl-head">
        <h3>Plan</h3>
        {actions}
      </div>
      <div className="pl-body">{body}</div>
    </div>
  )
}

function Lines({
  kind,
  title,
  lines,
  readOnly,
  numbered,
  onTick,
  onCommit
}: {
  kind: Kind
  title: string
  lines: PlanLine[]
  readOnly: boolean
  numbered?: boolean
  onTick: (kind: Kind, i: number) => void
  onCommit: (kind: Kind, i: number, text: string) => boolean
}) {
  const one = kind === 'beats' ? 'Beat' : 'Shot'
  const done = lines.filter((l) => l.done).length
  return (
    <section className="pl-sec" aria-label={title}>
      <h4>
        {title}
        {done > 0 && (
          <span className="pl-done-n">
            {done} of {lines.length} done
          </span>
        )}
      </h4>
      <ol className="pl-lines">
        {lines.map((l, i) => (
          <li key={i} className={`pl-row${l.done ? ' done' : ''}`}>
            <label className="pl-tick">
              <input type="checkbox" checked={!!l.done} disabled={readOnly} onChange={() => onTick(kind, i)} aria-label={`${one} ${i + 1} done`} data-testid={`plan-${kind}-tick-${i}`} />
              <span aria-hidden>{l.done ? <Icon name="check" size={11} stroke={2.6} /> : numbered ? i + 1 : null}</span>
            </label>
            <PlanField value={l.text} label={`${one} ${i + 1}`} readOnly={readOnly} onCommit={(t) => onCommit(kind, i, t)} />
          </li>
        ))}
      </ol>
    </section>
  )
}

/** One line of the plan, edited where it stands. `onCommit` false: the line could not go, so it is put back. */
function PlanField({ value, label, readOnly, onCommit }: { value: string; label: string; readOnly: boolean; onCommit: (text: string) => boolean }) {
  const [v, setV] = useState(value)
  const cancelled = useRef(false)
  useEffect(() => setV(value), [value])
  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.currentTarget.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelled.current = true
      e.currentTarget.blur()
    }
  }
  return (
    <textarea
      className="pl-field selectable"
      rows={1}
      value={v}
      maxLength={PLAN_MAX.line}
      readOnly={readOnly}
      aria-label={label}
      spellCheck
      onChange={(e) => setV(e.target.value.replace(/\n/g, ' '))}
      onKeyDown={keys}
      onBlur={() => {
        const t = v.replace(/\s+/g, ' ').trim()
        if (cancelled.current || t === value) {
          cancelled.current = false
          return setV(value)
        }
        if (!onCommit(t)) setV(value)
      }}
    />
  )
}

/** Send to my phone for the plan: the same temporary home-Wi-Fi link as a video's (main/phone-share.ts), open while
 * this shows. The phone gets the plan with boxes to tick while filming. */
function PlanPhone({ slug, onDone }: { slug: string; onDone: () => void }) {
  const [share, setShare] = useState<PhoneShare | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [stopped, setStopped] = useState(false)
  useEffect(() => {
    let live = true
    reel.phone
      .startPlan(slug)
      .then((s) => live && setShare(s))
      .catch((e) => live && setError(userMessage(e)))
    return () => {
      live = false
      void reel.phone.stop()
    }
  }, [slug])
  useEffect(
    () =>
      reel.phone.onEvent((e) => {
        if (e.kind === 'page') setSent(true)
        else if (e.kind === 'stopped' && e.reason === 'timeout') setStopped(true)
      }),
    []
  )
  return (
    <div className="pl-phone" role="group" aria-label="Send the plan to your phone" data-testid="plan-phone-panel">
      {error ? (
        <p className="pl-phone-err" role="alert">
          {error} Copy works too: paste the plan into a note on your phone.
        </p>
      ) : (
        <>
          <div className="pl-qr">{share && !stopped ? <Qr url={share.url} /> : stopped ? null : <Spinner />}</div>
          <div className="pl-phone-t">
            <p>Point your phone's camera at this code. The plan opens there, ready to tick off while you film.</p>
            <p className="muted-sm">Your phone needs to be on the same Wi-Fi as this computer.</p>
            <p className={`pl-phone-s${sent ? ' sent' : ''}`} role="status" data-testid="plan-phone-status">
              {sent ? (
                <>
                  <Icon name="check" size={14} /> Sent. Check your phone.
                </>
              ) : stopped ? (
                'This code stopped after 15 minutes, to keep it private.'
              ) : share ? (
                'Waiting for your phone…'
              ) : (
                'Getting the code ready…'
              )}
            </p>
          </div>
        </>
      )}
      <button className="lk pl-phone-done" onClick={onDone} data-testid="plan-phone-done">
        Done
      </button>
    </div>
  )
}

/**
 * No editor connected: the plan typed by hand, in the same shape the editor would give (a hook and the beats). Enter
 * moves to the next line; only the button saves.
 */
export function PlanForm({ onSave, onConnect }: { onSave: (plan: ReelPlan) => Promise<void>; onConnect: () => void }) {
  const [topic, setTopic] = useState('')
  const [hook, setHook] = useState('')
  const [beats, setBeats] = useState(['', '', ''])
  const [saving, setSaving] = useState(false)
  const fields = useRef<(HTMLInputElement | null)[]>([])
  const focusSoon = useRef<number | null>(null)
  useEffect(() => {
    if (focusSoon.current === null) return
    fields.current[focusSoon.current]?.focus()
    focusSoon.current = null
  })
  const [missing, setMissing] = useState<'topic' | 'hook' | 'beat' | null>(null)
  const filled = beats.map((b) => b.trim()).filter(Boolean)
  const lacking = !topic.trim() ? 'topic' : !hook.trim() ? 'hook' : !filled.length ? 'beat' : null
  // field 0 is the topic, 1 the hook, 2.. the beats
  const next = (at: number) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const beat = at - 2
    if (beat === beats.length - 1 && beats.length < PLAN_MAX.beats && beats[beat].trim()) {
      focusSoon.current = at + 1
      setBeats((b) => [...b, ''])
    } else fields.current[at + 1]?.focus()
  }
  const submit = async () => {
    if (saving) return
    setMissing(lacking)
    if (lacking) return fields.current[lacking === 'topic' ? 0 : lacking === 'hook' ? 1 : 2]?.focus()
    setSaving(true)
    try {
      await onSave({ topic: topic.trim(), hooks: [hook.trim()], hook: 0, beats: filled.map((text) => ({ text })), shots: [] })
    } finally {
      setSaving(false)
    }
  }
  // what is still missing, said once Save is pressed; it clears as the field is filled in
  const shown = missing && lacking === missing ? missing : null
  const why = { topic: "Say what it's about first.", hook: 'Add the hook: the first thing you say.', beat: 'Add at least one beat.' }
  return (
    <form
      className="plan-form"
      data-testid="plan-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="pf-lead" data-testid="plan-empty">
        Haven't filmed it yet? Plan it here: the first thing you say, then the beats in order. Film from the plan.
      </p>
      <label className="pf-f">
        <span>What it's about</span>
        <input
          ref={(el) => void (fields.current[0] = el)}
          className="input"
          type="text"
          name="topic"
          autoComplete="off"
          value={topic}
          maxLength={PLAN_MAX.topic}
          placeholder="How I make sourdough without a mixer"
          aria-invalid={shown === 'topic' || undefined}
          aria-describedby={shown === 'topic' ? 'plan-missing' : undefined}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={next(0)}
        />
      </label>
      <label className="pf-f">
        <span>Hook</span>
        <input
          ref={(el) => void (fields.current[1] = el)}
          className="input"
          type="text"
          name="hook"
          autoComplete="off"
          value={hook}
          maxLength={PLAN_MAX.line}
          placeholder="The first line, the one that makes them stay"
          aria-invalid={shown === 'hook' || undefined}
          aria-describedby={shown === 'hook' ? 'plan-missing' : undefined}
          onChange={(e) => setHook(e.target.value)}
          onKeyDown={next(1)}
        />
      </label>
      <fieldset className="pf-f">
        <legend>Beats</legend>
        <ol className="pf-beats">
          {beats.map((b, i) => (
            <li key={i}>
              <span className="pf-n" aria-hidden>
                {i + 1}
              </span>
              <input
                ref={(el) => void (fields.current[i + 2] = el)}
                className="input"
                type="text"
                name={`beat-${i + 1}`}
                autoComplete="off"
                value={b}
                maxLength={PLAN_MAX.line}
                aria-label={`Beat ${i + 1}`}
                aria-invalid={(shown === 'beat' && i === 0) || undefined}
                aria-describedby={shown === 'beat' && i === 0 ? 'plan-missing' : undefined}
                placeholder={i === 0 ? 'What you say next, in a line' : undefined}
                onChange={(e) => setBeats((all) => all.map((x, k) => (k === i ? e.target.value : x)))}
                onKeyDown={next(i + 2)}
              />
            </li>
          ))}
        </ol>
        {beats.length < PLAN_MAX.beats && (
          <button
            type="button"
            className="lk pf-add"
            onClick={() => {
              focusSoon.current = beats.length + 2
              setBeats((b) => [...b, ''])
            }}
          >
            <Icon name="plus" size={14} /> Add a beat
          </button>
        )}
      </fieldset>
      <div className="pf-save">
        <button type="submit" className="btn" disabled={saving} data-testid="plan-save">
          Save the plan
        </button>
        {shown && (
          <span className="pf-missing" id="plan-missing" role="alert">
            {why[shown]}
          </span>
        )}
      </div>
      <p className="pf-editor muted-sm">
        An editor can plan it with you: a question or two, then hooks to pick from, the beats and the shots.{' '}
        <button type="button" className="lk" onClick={onConnect} data-testid="plan-connect">
          Connect an editor
        </button>
      </p>
    </form>
  )
}
