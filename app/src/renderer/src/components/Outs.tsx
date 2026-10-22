import { useEffect, useState } from 'react'
import type { ExportResult } from '../../../shared/api'
import { reel } from '../api'
import { useCloudSave, type SaveState } from './CloudSave'
import { Icon } from './icons'
import { BrandMark } from './brand'
import { FOLDER_APP } from './ui'
import { usePresence } from './motion'

type Saving = Exclude<SaveState, { kind: 'idle' }>

/**
 * Every way out of the app in one place: Export, then Send to my phone, with iCloud Drive and Google Drive
 * beside it (each shown only when it is on this computer). A cloud save exports first if needed.
 */
export function Outs({
  label,
  disabled,
  why,
  onExport,
  onPhone,
  exportFile
}: {
  label: string
  disabled: boolean
  why?: string
  onExport: () => void
  onPhone: () => void
  /** exports the version on screen without the dialog, for a cloud save */
  exportFile: () => Promise<ExportResult>
}) {
  const { drives, label: driveName, state, save, reset } = useCloudSave()
  const saving = state.kind === 'idle' ? null : state
  useEffect(() => {
    if (state.kind !== 'saved') return
    const t = window.setTimeout(reset, 4000)
    return () => window.clearTimeout(t)
  }, [state])

  return (
    <div className="outs">
      <button className="btn primary big" onClick={onExport} disabled={disabled} title={why} data-testid="export">
        <Icon name="export" size={17} /> {label}
      </button>
      <div className="row">
        <button className="btn grow" onClick={onPhone} disabled={disabled} title={why} data-testid="send-to-phone-reel">
          <Icon name="send" size={16} /> Send to my phone
        </button>
        {drives.map((d) => (
          <button
            key={d.folder}
            className="btn icon-only"
            disabled={disabled || state.kind === 'saving'}
            aria-label={`Save to ${driveName(d)}`}
            title={`Save to ${driveName(d)}`}
            onClick={() => void save(d, async () => (await exportFile()).video)}
            data-testid={`save-${d.label === 'iCloud Drive' ? 'icloud' : 'gdrive'}`}
          >
            <BrandMark name={d.label === 'iCloud Drive' ? 'icloud' : 'gdrive'} size={17} />
          </button>
        ))}
      </div>
      <SaveHelper saving={saving} name={saving ? driveName(saving.drive) : ''} onClose={reset} />
    </div>
  )
}

function SaveHelper({ saving, name, onClose }: { saving: Saving | null; name: string; onClose: () => void }) {
  const [last, setLast] = useState(saving)
  if (saving && saving !== last) setLast(saving)
  const { mounted, leaving } = usePresence(!!saving, 140)
  const s = saving ?? last
  if (!mounted || !s) return null
  const mark = s.drive.label === 'iCloud Drive' ? 'icloud' : 'gdrive'
  return (
    <div
      className={`pop helper${leaving ? ' leave' : ''}`}
      role="status"
      style={{ left: 0, right: 0, bottom: 'calc(100% + 8px)', ['--o' as string]: 'bottom right' }}
      data-testid="cloud-helper"
    >
      <div className="hh">
        <span className="ic">
          <BrandMark name={mark} size={16} />
        </span>
        <div>
          {s.kind === 'saving' && (
            <>
              <b>Saving to {name}</b>
              <span>Into a “Reel Studio” folder</span>
            </>
          )}
          {s.kind === 'saved' && (
            <>
              <b>Saved</b>
              <span>In {name} › Reel Studio</span>
            </>
          )}
          {s.kind === 'error' && (
            <>
              <b>Not saved</b>
              <span>{s.message}</span>
            </>
          )}
        </div>
        <span className="spacer" />
        {s.kind !== 'saving' && (
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {s.kind === 'saving' && (
        <div className="hb">
          <i />
        </div>
      )}
      {s.kind === 'saved' && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost small" onClick={() => void reel.app.openFolder(s.path)}>
            Show in {FOLDER_APP}
          </button>
        </div>
      )}
    </div>
  )
}
