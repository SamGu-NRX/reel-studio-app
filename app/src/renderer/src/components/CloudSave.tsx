import { useEffect, useState, type ReactNode } from 'react'
import type { CloudDrive } from '../../../shared/api'
import { driveNames } from '../../../shared/cloud-drive-names'
import { errorCode, reel, userMessage } from '../api'
import { Button, FOLDER_APP } from './ui'

const ICLOUD_URL = 'https://www.icloud.com/iclouddrive/'
const GDRIVE_URL = 'https://drive.google.com/drive/my-drive'

const ON_PHONE: Record<CloudDrive['label'], string> = {
  'iCloud Drive': 'On your iPhone, open the Files app, then iCloud Drive › Reel Studio.',
  'Google Drive': 'On your phone, open the Drive app and find the Reel Studio folder.'
}

/**
 * The cloud drives on this computer (null while they are being looked for), and the name each goes by:
 * "Google Drive (G:)" or "Google Drive (sam)" when there are two (shared/cloud-drive-names.ts).
 */
export function useCloudDrives() {
  const [drives, setDrives] = useState<CloudDrive[] | null>(null)
  useEffect(() => {
    let live = true
    reel.cloud.drives().then(
      (found) => live && setDrives(found),
      () => live && setDrives([])
    )
    return () => {
      live = false
    }
  }, [])
  const names = drives ? driveNames(drives) : []
  const label = (drive: CloudDrive): string => names[drives?.indexOf(drive) ?? -1] ?? drive.label
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

/**
 * "Phone can't open it?": iCloud Drive or Google Drive as one of the other ways. With a drive app on this computer,
 * one click copies the video into a Reel Studio folder on the drive; without one, the drive websites, for uploading
 * by hand. Either way it says where the video turns up on the phone.
 */
export function CloudSave({ video, icon }: { video: string; icon: ReactNode }) {
  const { drives, label } = useCloudDrives()
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const save = async (drive: CloudDrive) => {
    setState({ kind: 'saving', drive, pct: 0 })
    try {
      const path = await saveToDrive(video, drive, (pct) => setState({ kind: 'saving', drive, pct })).done
      setState(path ? { kind: 'saved', drive, path } : { kind: 'idle' })
    } catch (e) {
      setState({ kind: 'error', message: userMessage(e) })
    }
  }
  const buttons = drives?.length ? drives : null
  return (
    <div className="phone-way" data-testid="cloud-save">
      {icon}
      <div>
        <b>Put it in iCloud Drive or Google Drive</b>
        {drives === null && <p className="muted-sm">Looking for your drives…</p>}
        {drives && (
          <p className="muted-sm">
            {buttons
              ? 'Saves a copy of the video in a Reel Studio folder on your drive. Then open it on your phone and save it from there.'
              : 'Upload the video at icloud.com/iclouddrive or drive.google.com (the buttons open them). Then open the Files app (iPhone) or Drive app (Android) on your phone and save it from there.'}
          </p>
        )}
        {buttons && (
          <div className="row wrap cloud-buttons">
            {buttons.map((drive) => (
              // aria-disabled, not disabled: a disabled button drops keyboard focus to the page mid-save
              <Button
                size="small"
                key={drive.folder}
                aria-disabled={state.kind === 'saving'}
                onClick={() => state.kind !== 'saving' && void save(drive)}
              >
                Save to {label(drive)}
              </Button>
            ))}
          </div>
        )}
        <div role="status" data-testid="cloud-status">
          {state.kind === 'saving' && <p className="muted-sm cloud-note">Saving to {label(state.drive)} · {state.pct}%</p>}
          {state.kind === 'saved' && (
            <div className="cloud-note">
              <p>
                <b>Saved to {label(state.drive)}.</b> It shows up on your phone once your drive finishes syncing.
              </p>
              <p className="muted-sm">{ON_PHONE[state.drive.label]}</p>
              <button className="link inline" onClick={() => void reel.app.openFolder(state.path)}>
                Show in {FOLDER_APP}
              </button>
            </div>
          )}
        </div>
        {state.kind === 'error' && (
          <p role="alert" className="phone-note cloud-note">
            {state.message}
          </p>
        )}
      </div>
      {drives && !buttons && (
        <div className="stack cloud-sites">
          <a className="btn small" href={ICLOUD_URL} target="_blank" rel="noreferrer" data-testid="phone-icloud">
            iCloud Drive
          </a>
          <a className="btn small" href={GDRIVE_URL} target="_blank" rel="noreferrer" data-testid="phone-gdrive">
            Google Drive
          </a>
        </div>
      )}
    </div>
  )
}
