// Share › Other platforms: one video, cover and caption file per platform (#52), and Try 2 for the platforms that
// test two versions of a post themselves (#61). The editor decides what Try 2 changes; the creator confirms it or
// swaps the thing it changes. With no editor, the app picks another cover and nobody says "I".
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { PlatformExportResult, VersionInfo } from '../../../shared/api'
import { clock } from '../../../shared/progress'
import {
  PLATFORM_RULES, TRY_VARIABLES, checkPlatform, platformRule, sameVideo, secondTryPlatforms, secondTryProblem, tryFromProposal,
  type ExportIssue, type Platform, type PlatformTry, type TryProposal, type TryVariable
} from '../../../shared/platforms'
import { errorCode, reel, userMessage } from '../api'
import { Icon } from './icons'
import { FOLDER_APP } from './ui'
import { Strip, type Work } from './ShareStrip'

const andList = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0])
// Try 2 never changes the version, so the frame rate only matters for a cover change, which is never the same frame.
const fps = 30
const THING: Record<TryVariable, string> = { hook: 'Hook line', cover: 'Cover', caption: 'Caption', brightness: 'Brightness' }

/** What Try 2 becomes, in a few words: the new hook line or caption in quotes, the frame, or the brightness. */
function valueWords(p: TryProposal): string {
  switch (p.variable) {
    case 'hook': case 'caption': return `“${p.value}”`
    case 'cover': return `The frame at ${clock(p.value)}`
    case 'brightness': return `${Math.round(Math.abs(p.value) * 100)}% ${p.value > 0 ? 'brighter' : 'darker'}`
  }
}

type Saving = { kind: 'saving'; pct: number | null; jobId: string | null; stopping: boolean }
type State = { kind: 'idle' } | Saving | { kind: 'saved'; result: PlatformExportResult } | { kind: 'failed'; message: string }
type Ask = { key: string; kind: 'asking' } | { key: string; kind: 'ready'; proposal: TryProposal; notice?: string } | { key: string; kind: 'failed'; message: string }

export function SharePlatforms({ slug, version, caption, open, disabled, onWork, beforeSave, onSaved }: {
  slug: string
  version: VersionInfo
  caption: string
  /** The section is showing: the editor is asked for Try 2 only then. */
  open: boolean
  disabled: boolean
  /** What this section is doing, for the ring on the Share button while Share is closed. */
  onWork: (work: Work | null) => void
  /** Before the files are written: the caption is saved first. */
  beforeSave: () => Promise<void>
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<Platform[]>(['instagram'])
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [seconds, setSeconds] = useState<Record<number, number>>({})
  // The creator's swap, then the editor's answer for this version and thing; `confirmed` is Try 2 in use.
  const [variable, setVariable] = useState<TryVariable | undefined>(undefined)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  // Known from the first answer: an editor answered, or was asked and couldn't. Only then can the creator swap.
  const [editor, setEditor] = useState(false)
  const saving = state.kind === 'saving'
  const stopAsked = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  // A saved line and Try 2 belong to the version they were for; work under way keeps going.
  useEffect(() => {
    setState((s) => (s.kind === 'saving' ? s : { kind: 'idle' }))
    setVariable(undefined)
    setConfirmed(false)
  }, [version.n])

  useEffect(() => {
    if (seconds[version.n] !== undefined) return
    let live = true
    void reel.projects.timeline(slug, version.n).then((t) => { if (live && t) setSeconds((l) => ({ ...l, [version.n]: t.duration })) }).catch(() => {})
    return () => { live = false }
  }, [slug, version.n, seconds])

  const testing = selected.filter((p) => platformRule(p).tryTwo)
  // Asked once per version and thing, when the section shows with a platform that can test two versions.
  const askKey = `${version.n}|${variable ?? ''}`
  const wanted = open && testing.length > 0
  useEffect(() => {
    if (!wanted || ask?.key === askKey) return
    let live = true
    setAsk({ key: askKey, kind: 'asking' })
    reel.projects.proposeTry(slug, version.n, { caption, ...(variable ? { variable } : {}) }).then(
      (r) => {
        if (!live) return
        setAsk({ key: askKey, kind: 'ready', proposal: r.proposal, notice: r.notice })
        setEditor(r.proposal.reason !== null || !!r.notice)
      },
      (e) => live && setAsk({ key: askKey, kind: 'failed', message: userMessage(e) })
    )
    return () => { live = false }
  }, [wanted, askKey]) // eslint-disable-line react-hooks/exhaustive-deps -- the caption at the time of asking; Try 2 is joined with the caption as it is at export

  // Saving starts below a long list: bring the bar and Stop into view.
  useEffect(() => {
    if (saving) root.current?.querySelector('.sp-strip')?.scrollIntoView({ block: 'nearest' })
  }, [saving])

  // The export (and, for a preview, the full-quality render before it) runs as this reel's job: follow it for the bar
  // and Stop. A Stop pressed before the job had an id lands as soon as it has one.
  useEffect(() => {
    if (!saving) return
    return reel.jobs.onEvent((e) => {
      if (e.slug !== slug || e.type !== 'status') return
      if (stopAsked.current) void reel.jobs.cancel(e.jobId)
      setState((s) => (s.kind === 'saving' ? { ...s, pct: e.overall || e.pct || null, jobId: e.jobId } : s))
    })
  }, [saving, slug])

  const label = `Saving for ${selected.length} ${selected.length === 1 ? 'platform' : 'platforms'}`
  const work: Work | null =
    state.kind === 'saving' ? { kind: 'working', label: state.stopping ? 'Stopping' : state.pct ? `${label} · ${Math.round(state.pct)}%` : label, pct: state.pct }
      : state.kind === 'failed' ? { kind: 'failed', message: state.message }
      : null
  const onWorkRef = useRef(onWork)
  onWorkRef.current = onWork
  const workKey = work ? `${work.kind}:${work.kind === 'working' ? work.label : work.message}` : ''
  useEffect(() => onWorkRef.current(work), [workKey]) // eslint-disable-line react-hooks/exhaustive-deps -- `work` is rebuilt each render; its key says when it changed

  const current = ask?.key === askKey ? ask : null
  const shown = current?.kind === 'ready' ? current.proposal : null
  const toggle = (p: Platform) => setSelected((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]))
  const swap = (v: TryVariable) => {
    if (v === shown?.variable) return
    setVariable(v)
    setConfirmed(false)
  }
  const pickKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step || !shown) return
    e.preventDefault()
    const i = (TRY_VARIABLES.indexOf(shown.variable) + step + TRY_VARIABLES.length) % TRY_VARIABLES.length
    swap(TRY_VARIABLES[i])
    e.currentTarget.querySelectorAll<HTMLElement>('[role=radio]')[i]?.focus()
  }

  const first: PlatformTry = { version: version.n, caption, coverSeconds: null }
  const second = confirmed && shown && testing.length ? tryFromProposal(first, shown) : null
  const secondPlatforms = second ? secondTryPlatforms(selected, sameVideo(first, second)) : []
  const problem = second ? secondTryProblem(selected, first, second, fps) : null
  // Until the length is read, NaN passes every length rule, so the caption is still checked. Main checks again.
  const length = seconds[version.n] ?? Number.NaN
  const issuesFor = (p: Platform): ExportIssue[] => checkPlatform(p, caption, length)
  const tryIssues = second ? secondPlatforms.flatMap((p) => checkPlatform(p, second.caption, length).filter((i) => i.kind !== 'duration').map((i) => `${platformRule(p).label}: ${i.message}`)) : []
  const blocked = selected.some((p) => issuesFor(p).some((i) => i.blocking)) || (second !== null && secondPlatforms.some((p) => checkPlatform(p, second.caption, length).some((i) => i.blocking)))
  const ready = selected.length > 0 && !blocked && !problem && !disabled
  const edges = selected.filter((p) => p !== 'instagram').map((p) => platformRule(p).label)

  const save = async () => {
    stopAsked.current = false
    setState({ kind: 'saving', pct: null, jobId: null, stopping: false })
    try {
      await beforeSave()
      const result = await reel.projects.exportPlatforms(slug, version.n, { platforms: selected, caption, coverSeconds: null, second })
      setState({ kind: 'saved', result })
      onSaved()
    } catch (e) {
      // Stop is not a failure: the strip goes and nothing else is said.
      setState(errorCode(e) === 'CANCELLED' ? { kind: 'idle' } : { kind: 'failed', message: userMessage(e) })
    }
  }
  const stop = () => {
    stopAsked.current = true
    setState((s) => (s.kind === 'saving' ? { ...s, stopping: true } : s))
    if (state.kind === 'saving' && state.jobId) void reel.jobs.cancel(state.jobId)
  }

  return (
    <div ref={root} className="sp-plat" data-enter data-testid="share-platforms">
      <fieldset className="sp-checks" disabled={saving}>
        <legend className="sr-only">Platforms</legend>
        {PLATFORM_RULES.map((rule) => {
          const issues = selected.includes(rule.id) ? issuesFor(rule.id) : []
          return (
            <div key={rule.id} className="sp-check-row">
              <label className="sp-check">
                <input type="checkbox" checked={selected.includes(rule.id)} onChange={() => toggle(rule.id)} aria-describedby={issues.length ? `sp-warn-${rule.id}` : undefined} />
                <span>{rule.label}</span>
              </label>
              {issues.length > 0 && (
                <p id={`sp-warn-${rule.id}`} className="sp-warn" data-testid="platform-warning">
                  {issues.map((i) => i.message).join(' ')}
                </p>
              )}
            </div>
          )
        })}
      </fieldset>
      {edges.length > 0 && (
        <p className="sp-warn sp-warn-gap" data-testid="edges-warning">
          {andList(edges)} {edges.length === 1 ? 'puts' : 'put'} buttons near the edges that can cover subtitles. Check them before you post.
        </p>
      )}

      {testing.length > 0 && (
        <section className="sp-try" aria-labelledby="try-two-h" aria-busy={current?.kind === 'asking'} data-testid="try-two">
          <h3 id="try-two-h" className="sp-try-h">Try two versions</h3>
          {editor && (
            <div className="sp-things" role="radiogroup" aria-label="What Try 2 changes" onKeyDown={pickKey}>
              {TRY_VARIABLES.map((v) => {
                const on = (shown?.variable ?? variable) === v
                return (
                  <button key={v} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={`sp-thing${on ? ' on' : ''}`} disabled={saving} onClick={() => swap(v)}>
                    {THING[v]}
                  </button>
                )
              })}
            </div>
          )}
          {/* The live region stays put so each answer is read out; the keyed block inside fades in. */}
          <div role="status" data-testid="try-two-proposal">
            <div className="sp-prop" key={current?.kind === 'ready' ? `${askKey}|ready` : askKey}>
              {!current || current.kind === 'asking' ? (
                <p className="muted-sm">{variable ? `Asking your editor for a new ${THING[variable].toLowerCase()}` : 'Choosing what Try 2 changes'}…</p>
              ) : current.kind === 'failed' ? (
                <p className="sp-warn">{current.message}</p>
              ) : current.proposal.reason === null ? (
                <p className="sp-value">Try 2 uses another cover: {valueWords(current.proposal).toLowerCase()}.</p>
              ) : (
                <>
                  <p className="sp-value">{valueWords(current.proposal)}</p>
                  <p className="sp-reason" data-testid="try-two-reason">{current.proposal.reason}</p>
                </>
              )}
              {current?.kind === 'ready' && current.notice && <p className="muted-sm">{current.notice}</p>}
            </div>
          </div>
          {shown && (confirmed ? (
            <p className="sp-on" data-testid="try-two-on">
              <Icon name="check" size={14} />
              <span>
                Try 2 is on{secondPlatforms.length > 0 && ` · ${andList(secondPlatforms.map((p) => platformRule(p).label))} ${secondPlatforms.length === 1 ? 'tests' : 'test'} both`}
              </span>
              <button type="button" className="link sp-act" disabled={saving} onClick={() => setConfirmed(false)} data-testid="try-two-undo">Undo</button>
            </p>
          ) : (
            <button type="button" className="btn small sp-use" disabled={saving} onClick={() => setConfirmed(true)} data-testid="try-two-use">Use Try 2</button>
          ))}
          {(problem || tryIssues.length > 0) && <p className="sp-warn" data-testid="try-two-warning">{[problem, ...tryIssues].filter(Boolean).join(' ')}</p>}
        </section>
      )}

      {work ? (
        <Strip work={work} onCancel={state.kind === 'saving' && !state.stopping ? stop : undefined} onRetry={ready ? () => void save() : undefined} />
      ) : (
        selected.length > 0 && (
          <button type="button" className="btn small sp-save" disabled={!ready} onClick={() => void save()} data-testid="export-selected">
            Save for {selected.length} {selected.length === 1 ? 'platform' : 'platforms'}
          </button>
        )
      )}
      {state.kind === 'saved' && <Saved result={state.result} />}
    </div>
  )
}

function Saved({ result }: { result: PlatformExportResult }) {
  const platforms = [...new Set(result.files.map((f) => f.platform))]
  const two = result.files.some((f) => f.try)
  const firstOnly = platforms.filter((p) => !platformRule(p).tryTwo).map((p) => platformRule(p).label)
  return (
    <div className="sp-saved" role="status" data-testid="export-saved">
      {platforms.map((p) => {
        const own = result.files.filter((f) => f.platform === p)
        const test = platformRule(p).tryTwo
        return (
          <div key={p} data-testid="export-platform">
            <p className="sp-done">
              <Icon name="check" size={14} />
              <span>
                Saved {own.length === 2 ? '2 tries ' : ''}for {platformRule(p).label} ·{' '}
                <button className="link inline" onClick={() => void reel.app.openFolder(own[0].video)} aria-label={`Show the ${platformRule(p).label} files in ${FOLDER_APP}`}>Show</button>
              </span>
            </p>
            {two && test && own.length === 2 && <p className="muted-sm sp-steps">{test.steps}{own[0].video === own[1].video && test.tests === 'video' ? ' Both use the same video.' : ''}</p>}
          </div>
        )
      })}
      {two && firstOnly.length > 0 && (
        <p className="muted-sm sp-steps" data-testid="export-first-only">
          {andList(firstOnly)} {firstOnly.length === 1 ? "gets Try 1 only. It can't" : "get Try 1 only. They can't"} test two versions of a post, and posting both would show your followers the same reel twice.
        </p>
      )}
    </div>
  )
}
