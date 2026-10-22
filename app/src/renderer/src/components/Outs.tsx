import { useEffect, useState } from 'react'
import type { CloudDrive, ExportResult } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Icon } from './icons'
import { BrandMark } from './brand'
import { FOLDER_APP } from './ui'
import { usePresence } from './motion'

type Saving = { drive: CloudDrive; state: 'saving' } | { drive: CloudDrive; state: 'saved'; path: string } | { drive: CloudDrive; state: 'error'; message: string }

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
  const [drives, setDrives] = useState<CloudDrive[]>([])
  const [saving, setSaving] = useState<Saving | null>(null)
  useEffect(() => {
    let live = true
    reel.cloud
      .drives()
      .then((d) => live && setDrives(d))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const label2 = (d: CloudDrive) => (drives.filter((x) => x.label === d.label).length > 1 ? `${d.label} · ${d.folder.match(/GoogleDrive-([^/\\]+)/)?.[1] ?? ''}` : d.label)
  const save = async (d: CloudDrive) => {
    setSaving({ drive: d, state: 'saving' })
    try {
      const file = await exportFile()
      const path = await reel.cloud.save(file.video, d.folder)
      setSaving({ drive: d, state: 'saved', path })
    } catch (e) {
      setSaving({ drive: d, state: 'error', message: userMessage(e) })
    }
  }
  useEffect(() => {
    if (saving?.state !== 'saved') return
    const t = window.setTimeout(() => setSaving(null), 4000)
    return () => window.clearTimeout(t)
  }, [saving])

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
            disabled={disabled || saving?.state === 'saving'}
            aria-label={`Save to ${label2(d)}`}
            title={`Save to ${label2(d)}`}
            onClick={() => void save(d)}
            data-testid={`save-${d.label === 'iCloud Drive' ? 'icloud' : 'gdrive'}`}
          >
            <BrandMark name={d.label === 'iCloud Drive' ? 'icloud' : 'gdrive'} size={17} />
          </button>
        ))}
      </div>
      <SaveHelper saving={saving} name={saving ? label2(saving.drive) : ''} onClose={() => setSaving(null)} />
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
    <div className={`pop helper${leaving ? ' leave' : ''}`} role="status" style={{ left: 0, right: 0, bottom: 'calc(100% + 8px)', ['--o' as string]: 'bottom right' }} data-testid="cloud-helper">
      <div className="hh">
        <span className="ic">
          <BrandMark name={mark} size={16} />
        </span>
        <div>
          {s.state === 'saving' && (
            <>
              <b>Saving to {name}</b>
              <span>Into a “Reel Studio” folder</span>
            </>
          )}
          {s.state === 'saved' && (
            <>
              <b>Saved</b>
              <span>
                In {name} › Reel Studio
              </span>
            </>
          )}
          {s.state === 'error' && (
            <>
              <b>Not saved</b>
              <span>{s.message}</span>
            </>
          )}
        </div>
        <span className="spacer" />
        {s.state !== 'saving' && (
          <button className="icon-btn small" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
      {s.state === 'saving' && (
        <div className="hb">
          <i />
        </div>
      )}
      {s.state === 'saved' && (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost small" onClick={() => void reel.app.openFolder(s.path)}>
            Show in {FOLDER_APP}
          </button>
        </div>
      )}
    </div>
  )
}
