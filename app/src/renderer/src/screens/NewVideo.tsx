import { useState } from 'react'
import type { Go } from '../nav'
import { FOLDER_APP, MOD, PickFiles, Spinner, useFileDrop } from '../components/ui'
import '../components/intake.css'
import { Icon } from '../components/icons'
import { useNotify } from '../App'
import { createFromFiles } from './create'

export function NewVideo({ go, files }: { go: Go; files?: string[] }) {
  const notify = useNotify()
  const [busy, setBusy] = useState(false)
  // Shown right under the drop zone, where the file was dropped (never a toast on another screen).
  const [error, setError] = useState<string | null>(null)
  const start = async (paths: string[]) => {
    setBusy(true)
    setError(null)
    await createFromFiles(paths, go, notify, setError)
    setBusy(false)
  }
  const drop = useFileDrop(start)

  return (
    <div className="page narrow">
      <button className="back" onClick={() => go({ name: 'home' })}>
        <Icon name="back" size={16} /> My videos
      </button>
      <div className="page-head">
        <div>
          <h1>New video</h1>
          <p className="muted">Retakes and fumbles are fine. I'll pick your best takes.</p>
        </div>
      </div>
      {files?.length ? (
        <div className="drop tall" data-testid="drop-zone">
          <div className="filecard" data-testid="opened-file">
            <span className="th">
              <Icon name="video" size={20} />
            </span>
            <div style={{ minWidth: 0 }}>
              <b>{files[0].split(/[\\/]/).pop()}</b>
              <span>{files.length > 1 ? `and ${files.length - 1} more · ` : ''}Opened with Reel Studio</span>
            </div>
            <span className="spacer" />
            <button className="btn primary" autoFocus disabled={busy} onClick={() => void start(files)} data-testid="make-from">
              {busy ? <Spinner /> : null} Make my reel
            </button>
          </div>
          <button className="link" onClick={() => go({ name: 'new' })}>
            Use a different video
          </button>
        </div>
      ) : (
      <div className={`drop tall${drop.over ? ' over' : ''}`} {...drop.props} data-testid="drop-zone">
        <div className="drop-icon">{busy ? <Spinner /> : <Icon name="upload" size={28} />}</div>
        <h2>Drop your video here</h2>
        <p className="muted">You can drop more than one take.</p>
        <PickFiles className="btn primary big" label="Choose video" accept="video/*,.mov,.mp4,.m4v" onFiles={start} />
        <p className="muted-sm">
          or paste one you copied in {FOLDER_APP} <kbd className="kbd">{MOD.replace('+', '')}</kbd> <kbd className="kbd">V</kbd>
        </p>
      </div>
      )}
      {error && (
        <div className="banner error" role="alert" style={{ marginTop: 14 }} data-testid="new-error">
          {error}
        </div>
      )}
      <div style={{ textAlign: 'center', marginTop: 22 }}>
        <button className="link" onClick={() => go({ name: 'script' })}>
          I want help writing a script first
        </button>
      </div>
    </div>
  )
}
