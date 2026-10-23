import { RELEASES_URL } from '../../../shared/config'
import { updateAction } from '../../../shared/update'
import { updateSummary } from './update-copy'
import { Icon } from './icons'
import { Button, Progress } from './ui'
import { useUpdateActions, useUpdateState } from './update'

/** Under Settings › Check for updates: where the update stands, and the one thing to do about it. */
export function UpdateSettingsRow() {
  const s = useUpdateState()
  const { act, pending, dialog } = useUpdateActions()
  if (!s) return null
  const action = updateAction(s)
  const disabled = ['disabled', 'checking', 'downloading', 'installing'].includes(s.status)
  const text = s.status === 'idle' ? `You have Reel Studio ${s.currentVersion}.` : updateSummary(s).replace(/ Click to .*$/, '')
  const button = action !== 'none' ? (s.status === 'error' ? 'Try again' : action === 'install' ? 'Restart to update' : 'Download')
    : s.status === 'checking' ? 'Checking…' : s.status === 'downloading' ? 'Downloading…' : s.status === 'installing' ? 'Restarting…'
    : s.status === 'up-to-date' ? 'Check again' : s.status === 'error' ? 'Try again' : 'Check now'
  return (
    <div className="srow-more update-row" data-testid="update-settings">
      <div className="update-row-line">
        <p className="muted-sm" data-testid="update-settings-text">
          {text}
        </p>
        {s.status !== 'disabled' && (
          <Button size="small" disabled={disabled || pending} onClick={() => void act(s)} data-testid="update-settings-button">
            {button}
          </Button>
        )}
      </div>
      {s.status === 'downloading' && <Progress pct={s.downloadPercent ?? 0} label="Downloading the update" />}
      <span className="sr-only" role="status">
        {s.status === 'downloading' ? 'Downloading the update.' : text}
      </span>
      {dialog}
    </div>
  )
}

/** What's new: the waiting update's changes, scrollable, or the releases page while there is none. */
export function WhatsNew() {
  const s = useUpdateState()
  // the newest release this copy can update to; older ones are on the releases page
  const notes = s?.releaseNotes[0]
  const more = notes ? notes.totalItems - notes.items.length : 0
  return (
    <div className="srow-more">
      {notes ? (
        <>
          <p className="muted-sm">In Reel Studio {notes.version}</p>
          <ul className="whats-new" tabIndex={0} aria-label={`What’s new in Reel Studio ${notes.version}`} data-testid="whats-new">
            {notes.items.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {more > 0 && <p className="muted-sm">And {more} more on the releases page.</p>}
        </>
      ) : (
        <p className="muted-sm">Every version’s changes are on the releases page.</p>
      )}
      <a className="ext-link" href={RELEASES_URL} target="_blank" rel="noreferrer" data-testid="update-releases-link">
        Releases page <Icon name="external" size={12} stroke={2} />
      </a>
    </div>
  )
}
