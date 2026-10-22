import { useRef, useState } from 'react'
import { clock } from '../../../shared/progress'
import { timeLeftWords, type LiveState } from '../../../shared/live'
import { Icon } from './icons'
import { usePlayhead, type Playhead } from './playhead'
import { AttachmentChips, type useNoteAttachments } from './NoteAttachments'
import { usePresence } from './motion'

export type Chip = { at: number } | null

/**
 * The note box. Its top edge carries the progress strip while a version is being made (Steps, Stop), or
 * the held notes after Stop. A time chip offers the moment on screen; pressed, the note is about that moment.
 */
export function Composer({
  where,
  draft,
  onDraft,
  chip,
  onChip,
  playhead,
  att,
  aiOn,
  checking,
  job,
  making,
  steps,
  held,
  alert,
  onSend,
  onStop,
  onRunNext,
  onClear,
  onConnect,
  inputRef
}: {
  where: 'main' | 'zoom'
  draft: string
  onDraft: (t: string) => void
  chip: Chip
  onChip: (c: Chip) => void
  playhead: Playhead
  att: ReturnType<typeof useNoteAttachments>
  aiOn: boolean
  checking: boolean
  job: LiveState | null
  /** the version the running job will make */
  making: number | null
  steps: string[]
  /** notes held after Stop or a failed note */
  held: number
  alert: string | null
  onSend: () => void
  onStop: () => void
  onRunNext: () => void
  onClear: () => void
  onConnect: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement | null>
}) {
  const second = usePlayhead(playhead, Math.floor)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [focus, setFocus] = useState(false)
  const strip = job ? 'job' : held ? 'held' : null
  const { mounted: stripShown } = usePresence(!!strip, 200)
  const ownRef = useRef<HTMLTextAreaElement>(null)
  const field = inputRef ?? ownRef
  const canSend = (!!draft.trim() || att.chips.length > 0) && !att.busy && !checking

  if (!checking && !aiOn)
    return (
      <div className="cbox">
        <div className="noai-cin">
          <span>Connect an AI editor to ask for changes.</span>
          <button className="btn small" onClick={onConnect} data-testid="composer-connect">
            Connect
          </button>
        </div>
      </div>
    )

  const pct = job ? Math.min(1, job.overall / 100) : 0
  const left = job ? timeLeftWords(job) : null
  return (
    <div className={`cbox${focus ? ' focus' : ''}`} data-note-drop={where === 'main' || undefined}>
      <div className={`stripwrap${strip ? ' on' : ''}`}>
        <div>
          {stripShown && strip === 'job' && job && (
            <>
              <div className={`steps${stepsOpen ? ' on' : ''}`}>
                <ul aria-label="Steps">
                  {steps.map((s, i) => (
                    <li key={`${i}-${s}`} className={i === steps.length - 1 ? 'cur' : undefined}>
                      {i < steps.length - 1 ? (
                        <span className="ok">
                          <Icon name="check" size={8} stroke={3} />
                        </span>
                      ) : (
                        <span className="spin light" />
                      )}
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="strip" role="status" data-testid="note-progress">
                <span className="bar" aria-hidden>
                  <i style={{ transform: `scaleX(${pct})` }} />
                </span>
                <span className="spin light" aria-hidden />
                <b>{making ? `Making Version ${making}` : job.message}</b>
                {left && (
                  <span className="m" data-testid="note-time-left">
                    · {left}
                  </span>
                )}
                <span className="sp" />
                <button className="sbtn" aria-expanded={stepsOpen} onClick={() => setStepsOpen((o) => !o)} data-testid="steps">
                  Steps <Icon name={stepsOpen ? 'chevron-down' : 'up'} size={12} stroke={2} />
                </button>
                <button className="sbtn" onClick={onStop} data-testid="stop">
                  Stop
                </button>
              </div>
            </>
          )}
          {stripShown && strip === 'held' && (
            <div className="strip wait" role="status" data-testid="queue-held">
              <b data-testid="queue-count">{held === 1 ? '1 note held' : `${held} notes held`}</b>
              <span className="m">· because you stopped</span>
              <span className="sp" />
              <button className="sbtn" onClick={onClear} data-testid="queue-clear">
                Clear
              </button>
              <button className="sbtn" onClick={onRunNext} data-testid="queue-run-next">
                <Icon name="play" size={11} stroke={2.5} /> Send now
              </button>
            </div>
          )}
        </div>
      </div>
      <AttachmentChips chips={att.chips} busy={att.busy} onRemove={(a) => void att.remove(a)} />
      {alert && (
        <p className="cin-alert" role="alert" data-testid="change-alert">
          {alert}
        </p>
      )}
      <div className="cin">
        <button
          className="att"
          onClick={att.choose}
          disabled={checking}
          aria-label="Attach a picture or a clip"
          title="Attach a picture or a clip"
          data-testid="note-attach"
        >
          <Icon name="paperclip" size={17} />
        </button>
        <div className="cfield">
          {chip ? (
            <span className="tchip" data-testid="moment-chip">
              {clock(chip.at)}
              <button
                className="x"
                aria-label="Remove the moment"
                onClick={() => {
                  onChip(null)
                  field.current?.focus()
                }}
              >
                <Icon name="x" size={12} stroke={2} />
              </button>
            </span>
          ) : (
            <button
              className="tchip suggest"
              onClick={() => {
                onChip({ at: playhead.get() })
                field.current?.focus()
              }}
              aria-label={`Attach the moment on screen, ${clock(second)}`}
              title="Ask about this moment"
              disabled={checking}
              data-testid="moment-suggest"
            >
              <Icon name="plus" size={12} stroke={2} />
              {clock(second)}
            </button>
          )}
          <textarea
            ref={field}
            rows={1}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onPaste={checking ? undefined : att.onPaste}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (canSend) onSend()
              }
            }}
            disabled={checking}
            aria-label="Tell your editor what to change"
            placeholder={checking ? 'Checking for your AI editor…' : job ? 'Your next note waits for this one…' : 'Tell your editor what to change…'}
            data-testid="note-input"
          />
        </div>
        <button className={`send${canSend ? ' ready' : ''}`} onClick={onSend} disabled={!canSend} aria-label="Send" data-testid="send">
          <Icon name="arrow-up" size={16} stroke={2} />
        </button>
      </div>
    </div>
  )
}
