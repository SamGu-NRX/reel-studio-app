import { useEffect, useRef, useState } from 'react'
import type { ModelStatus } from '../../../../shared/api'
import { reel, userMessage } from '../../api'
import { useModelStatus } from '../connect'
import { Icon } from '../icons'

const mb = (b: number) => Math.round(b / 1e6)
const CHECK_FAILED = "I couldn't work out the fastest settings for this computer, so the listening model uses its usual ones. Everything still works."

/** "About a minute left", from a smoothed download rate. null until there is enough to go on. */
export function etaWords(left: number, rate: number): string | null {
  if (rate <= 0) return null
  const sec = left / rate
  if (sec > 90) return `About ${Math.ceil(sec / 60)} minutes left`
  if (sec > 52) return 'About a minute left'
  if (sec > 12) return `About ${Math.ceil(sec / 10) * 10} seconds left`
  return 'A few seconds left'
}

/**
 * The listening model, started the moment the first run starts: a copy already on this computer is used, else it
 * downloads. It never blocks a step; this is the one quiet line that says how far along it is.
 */
export function useListeningModel(): { s: ModelStatus | null; eta: string | null; error: string | null; retry: () => void } {
  const { s, looked, failed, retry } = useModelStatus()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const sample = useRef<{ t: number; b: number } | null>(null)
  const [rate, setRate] = useState(0)

  useEffect(() => {
    if (!looked || !s || started.current || s.installed || s.downloading || s.checking) return
    started.current = true
    reel.model.download().catch((e) => setError(userMessage(e)))
  }, [looked, s])

  useEffect(() => {
    if (!s?.downloading) return
    const now = performance.now()
    const last = sample.current
    if (last && now - last.t > 400) {
      const r = ((s.bytes - last.b) * 1000) / (now - last.t)
      setRate((old) => (old ? old * 0.85 + r * 0.15 : r))
      sample.current = { t: now, b: s.bytes }
    } else if (!last) sample.current = { t: now, b: s.bytes }
  }, [s])

  return {
    s,
    eta: s?.downloading && s.total > 0 ? etaWords(s.total - s.bytes, rate) : null,
    error: error ?? s?.error ?? (failed ? "I couldn't check for the listening model." : null),
    retry: () => {
      setError(null)
      started.current = false
      sample.current = null
      setRate(0)
      retry()
    }
  }
}

export function ModelLine({ model, place, computer }: { model: ReturnType<typeof useListeningModel>; place: 'panel' | 'side'; computer: string }) {
  const { s, eta, error, retry } = model
  if (!s && !error) return null
  const pct = s && s.total > 0 ? s.bytes / s.total : (s?.pct ?? 0) / 100
  const panel = place === 'panel'
  let body
  if (error)
    body = (
      <>
        <Icon name="alert" size={15} />
        <b>Listening model</b>
        <button className="link inline n" onClick={retry} data-testid="model-retry">
          Try again
        </button>
        <span className="sub" data-testid="model-error">
          {error}
        </span>
      </>
    )
  else if (s!.installed)
    body = (
      <>
        <Icon name="check" size={15} />
        <b>Listening model ready</b>
        <span className="n" />
        {panel &&
          (s!.checkFailed ? (
            <span className="sub" data-testid="model-check-failed">
              {CHECK_FAILED}
            </span>
          ) : (
            <span className="sub">
              {s!.reused ? `Found one already on this ${computer}, so nothing to download.` : `It writes down every word you say, on this ${computer}.`}
            </span>
          ))}
      </>
    )
  else if (s!.checking)
    body = (
      <>
        <Icon name="wave" size={15} />
        <b>Listening model</b>
        <span className="n" />
        <span className="sub">Checking the copy already on this {computer}</span>
      </>
    )
  else
    body = (
      <>
        <Icon name="wave" size={15} />
        <b>Listening model</b>
        <span className="n">{s!.total > 0 ? `${mb(s!.bytes)} of ${mb(s!.total)} MB` : `${s!.pct}%`}</span>
        <span
          className="bar"
          role="progressbar"
          aria-label="Listening model download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(Math.min(1, pct) * 100)}
        >
          <i style={{ transform: `scaleX(${Math.min(1, pct).toFixed(4)})` }} />
        </span>
        <span className="sub">
          {panel
            ? `${eta ? `${eta}. ` : ''}It writes down every word you say, on this ${computer}.`
            : s!.downloading
              ? (eta ?? 'Downloading')
              : 'Waiting to download'}
        </span>
      </>
    )
  return (
    <div className={`fr-dl at-${place}${s?.installed ? ' ready' : ''}`} data-testid="model-line">
      {body}
      {/* said once per change of state, never once per percent */}
      <span className="sr-only" role="status">
        {error
          ? `Listening model: ${error}`
          : s!.installed
            ? 'Listening model ready'
            : s!.checking
              ? 'Checking the listening model'
              : 'Downloading the listening model'}
      </span>
    </div>
  )
}
