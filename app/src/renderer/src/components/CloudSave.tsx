import { useEffect, useState } from 'react'
import type { CloudDrive } from '../../../shared/api'
import { errorCode, reel, userMessage } from '../api'
import { Icon } from './icons'
import { Button, FOLDER_APP } from './ui'

/** The cloud drives on this computer, and the name each goes by ("Google Drive · Work" when there are two). */
export function useCloudDrives() {
  const [drives, setDrives] = useState<CloudDrive[]>([])
  useEffect(() => {
    let live = true
    void reel.cloud.drives().then((drives) => { if (live) setDrives(drives) }).catch(() => {})
    return () => { live = false }
  }, [])
  const label = (drive: CloudDrive) => {
    if (drives.filter((other) => other.label === drive.label).length === 1) return drive.label
    const account = drive.folder.match(/GoogleDrive-([^/\\]+)/)?.[1] ?? drive.folder
    return `${drive.label} · ${account}`
  }
  return { drives, label }
}

/** Copies an exported video into the drive's "Reel Studio" folder. `done` resolves to the new file, or null when cancelled. */
export function saveToDrive(video: string, drive: CloudDrive, onPct: (pct: number) => void): { done: Promise<string | null>; cancel: () => void } {
  const id = crypto.randomUUID()
  const off = reel.cloud.onProgress((p) => { if (p.id === id) onPct(p.pct) })
  const done = reel.cloud
    .save(video, drive.folder, id)
    .catch((e) => {
      if (errorCode(e) === 'CANCELLED') return null
      throw e
    })
    .finally(off)
  return { done, cancel: () => void reel.cloud.cancel(id) }
}

type SaveState = { kind: 'idle' } | { kind: 'saving'; drive: CloudDrive; pct: number } | { kind: 'saved'; drive: CloudDrive; path: string } | { kind: 'error'; message: string }

/** "Phone can't open it?": the drives as one of the other ways, for a video that is already exported. */
export function CloudSave({ video }: { video: string }) {
  const { drives, label } = useCloudDrives()
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  if (!drives.length) return null
  const save = async (drive: CloudDrive) => {
    setState({ kind: 'saving', drive, pct: 0 })
    try {
      const path = await saveToDrive(video, drive, (pct) => setState({ kind: 'saving', drive, pct })).done
      setState(path ? { kind: 'saved', drive, path } : { kind: 'idle' })
    } catch (e) {
      setState({ kind: 'error', message: userMessage(e) })
    }
  }
  return (
    <div className="phone-way" data-testid="cloud-save">
      <Icon name="folder" />
      <div className="stack" style={{ gap: 8 }}>
        <div className="row wrap" style={{ gap: 8 }}>
          {drives.map((drive) => (
            <Button size="small" key={drive.folder} disabled={state.kind === 'saving'} onClick={() => void save(drive)}>
              Save to {label(drive)}
            </Button>
          ))}
        </div>
        <div role="status" className="muted-sm">
          {state.kind === 'saving' && `Saving to ${label(state.drive)} · ${state.pct}%`}
          {state.kind === 'saved' && (
            <span className="row wrap" style={{ gap: 6 }}>
              Saved to {label(state.drive)} ·
              <button className="link inline" onClick={() => void reel.app.openFolder(state.path)}>Show in {FOLDER_APP}</button>
            </span>
          )}
        </div>
        {state.kind === 'error' && <p role="alert" className="phone-note">{state.message}</p>}
      </div>
    </div>
  )
}
