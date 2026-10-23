// Share › Other platforms: the presets (#52) and Try 2 (#61), for the caption at the top of Share. No preview video here:
// the reel has one player (Player.tsx), so each try uses its version's own cover.
import { useEffect, useRef, useState } from 'react'
import type { PlatformExportResult, VersionInfo } from '../../../shared/api'
import { PLATFORM_RULES, captionLength, checkPlatform, platformRule, secondTryPlatforms, secondTryProblem, tryChanges, type Platform, type PlatformTry } from '../../../shared/platforms'
import { errorCode, reel, userMessage } from '../api'
import { Icon } from './icons'
import { FOLDER_APP } from './ui'
import { Strip, type Work } from './ShareStrip'

const andList = (names: string[]): string => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0])
const limit = (s: number): string => (s >= 60 ? `${s / 60} min` : `${s} s`)
// Every try here uses its version's own cover (coverSeconds null), so the frame rate never decides a cover change.
const fps = 30

type State = { kind: 'idle' } | { kind: 'saving'; pct: number | null; jobId: string | null } | { kind: 'saved'; result: PlatformExportResult } | { kind: 'failed'; message: string }

export function SharePlatforms({ slug, version, versions, caption, disabled, onWork, beforeSave, onSaved }: {
  slug: string
  version: VersionInfo
  versions: VersionInfo[]
  caption: string
  disabled: boolean
  /** What this section is doing, for the ring on the Share button while Share is closed. */
  onWork: (work: Work | null) => void
  /** Before the files are written: the caption is saved first. */
  beforeSave: () => Promise<void>
  onSaved: () => void
}) {
  const [selected, setSelected] = useState<Platform[]>([])
  const [second, setSecond] = useState<PlatformTry | null>(null)
  const [safe, setSafe] = useState(false)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [lengths, setLengths] = useState<Record<number, number>>({})
  const saving = state.kind === 'saving'

  const needed = [version.n, ...(second ? [second.version] : [])].filter((n) => lengths[n] === undefined)
  useEffect(() => {
    let live = true
    for (const n of needed)
      void reel.projects.timeline(slug, n).then((t) => { if (live && t) setLengths((l) => ({ ...l, [n]: t.duration })) }).catch(() => {})
    return () => { live = false }
  }, [slug, needed.join()]) // eslint-disable-line react-hooks/exhaustive-deps -- `needed` is derived from the versions in use

  // The export (and, for a preview, the full-quality render before it) runs as this reel's job: follow it for the bar and Cancel.
  useEffect(() => {
    if (!saving) return
    return reel.jobs.onEvent((e) => {
      if (e.slug !== slug || e.type !== 'status') return
      setState((s) => (s.kind === 'saving' ? { kind: 'saving', pct: e.overall || e.pct || null, jobId: e.jobId } : s))
    })
  }, [saving, slug])

  const label = `Saving for ${selected.length} ${selected.length === 1 ? 'platform' : 'platforms'}`
  const work: Work | null =
    state.kind === 'saving' ? { kind: 'working', label: state.pct ? `${label} · ${Math.round(state.pct)}%` : label, pct: state.pct }
      : state.kind === 'failed' ? { kind: 'failed', message: state.message }
      : null
  const onWorkRef = useRef(onWork)
  onWorkRef.current = onWork
  const workKey = work ? `${work.kind}:${work.kind === 'working' ? work.label : work.message}` : ''
  useEffect(() => onWorkRef.current(work), [workKey]) // eslint-disable-line react-hooks/exhaustive-deps -- `work` is rebuilt each render; its key says when it changed

  const toggle = (p: Platform) => setSelected((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
  const first: PlatformTry = { version: version.n, caption, coverSeconds: null }
  const sameVideo = !second || second.version === version.n
  const tryNames = selected.filter((p) => platformRule(p).tryTwo).map((p) => platformRule(p).label)
  const secondPlatforms = second ? secondTryPlatforms(selected, sameVideo) : []
  const problem = second && selected.length ? secondTryProblem(selected, first, second, fps) : null
  const issues = (platforms: Platform[], text: string, seconds: number | undefined, prefix: string) =>
    seconds === undefined ? [] : platforms.flatMap((p) => checkPlatform(p, text, seconds).map((i) => ({ ...i, text: `${prefix}${platformRule(p).label}: ${i.message}` })))
  const checks = [
    ...issues(selected, caption, lengths[version.n], second ? 'Try 1 on ' : ''),
    ...(second ? issues(secondPlatforms, second.caption, lengths[second.version], 'Try 2 on ').filter((c) => c.kind !== 'duration' || !sameVideo) : [])
  ]
  const blocking = checks.filter((c) => c.blocking)
  const ready = selected.length > 0 && safe && !blocking.length && !problem && !disabled

  const save = async () => {
    setState({ kind: 'saving', pct: null, jobId: null })
    try {
      await beforeSave()
      const result = await reel.projects.exportPlatforms(slug, version.n, { platforms: selected, caption, coverSeconds: null, second })
      setState({ kind: 'saved', result })
      onSaved()
    } catch (e) {
      setState(errorCode(e) === 'CANCELLED' ? { kind: 'idle' } : { kind: 'failed', message: userMessage(e) })
    }
  }

  return (
    <div className="sp-plat" data-testid="share-platforms">
      <fieldset className="sp-checks" disabled={saving}>
        <legend className="sr-only">Platforms</legend>
        {PLATFORM_RULES.map((rule) => (
          <label className="sp-check" key={rule.id}>
            <input type="checkbox" checked={selected.includes(rule.id)} onChange={() => toggle(rule.id)} />
            <span>
              <b>{rule.label}</b>
              <small>Up to {limit(rule.maxSeconds)}{rule.captionLimit !== null && ` · caption ${captionLength(rule.id, caption)}/${rule.captionLimit}`}</small>
            </span>
            {rule.tryTwo && <span className="sp-tag">Try 2</span>}
          </label>
        ))}
      </fieldset>

      {tryNames.length > 0 && (
        <label className="sp-check">
          <input type="checkbox" checked={second !== null} disabled={saving} onChange={(e) => setSecond(e.target.checked ? { ...first } : null)} data-testid="try-two" />
          <span>
            <b>Try 2 on {andList(tryNames)}</b>
            <small>Post two versions and keep the one people like. The platform runs the test.</small>
          </span>
        </label>
      )}
      {second && tryNames.length > 0 && (
        <fieldset className="sp-try" disabled={saving} data-testid="try-two-panel">
          <legend className="sr-only">Try 2</legend>
          {versions.length > 1 ? (
            <div className="sp-vers" role="radiogroup" aria-label="Try 2 version">
              {versions.map((v) => (
                <button key={v.n} type="button" role="radio" aria-checked={v.n === second.version} className={`sp-ver${v.n === second.version ? ' on' : ''}`} onClick={() => setSecond({ ...second, version: v.n })}>
                  Version {v.n}
                </button>
              ))}
            </div>
          ) : (
            <small className="muted-sm">Same video, different caption. For a different video, leave a note to make another version.</small>
          )}
          <label className="sp-lbl" htmlFor="platform-caption-2">Try 2 caption</label>
          <textarea id="platform-caption-2" className="textarea sp-caption" rows={2} value={second.caption} onChange={(e) => setSecond({ ...second, caption: e.target.value })} aria-describedby="try-two-status" />
          <small id="try-two-status" role="status" className={problem ? 'sp-fail' : 'muted-sm'} data-testid="try-two-status">
            {problem ?? (tryChanges(first, second, fps).length > 1 ? "You changed more than one thing. If Try 2 wins, you won't know which change helped." : null)}
          </small>
        </fieldset>
      )}

      {selected.length > 0 && (
        <label className="sp-check">
          <input type="checkbox" checked={safe} disabled={saving} onChange={(e) => setSafe(e.target.checked)} />
          <span>
            <b>I checked the edges</b>
            <small>Platform buttons can cover subtitles and details near the edges. Nothing is cropped or moved.</small>
          </span>
        </label>
      )}
      {checks.length > 0 && (
        <ul className="sp-issues">
          {checks.map((c) => <li key={c.text} className={c.blocking ? 'sp-fail' : 'muted-sm'}>{c.text}</li>)}
        </ul>
      )}

      {work ? (
        <Strip work={work} onCancel={state.kind === 'saving' && state.jobId ? () => void reel.jobs.cancel(state.jobId!) : undefined} onRetry={ready ? () => void save() : undefined} />
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
