// Settings is rows and hairlines (ux-foundation-b.md section 9): a label, one line under it, a control on the right.
import { createContext, useContext, type ReactNode } from 'react'
import { SETTINGS, type SettingId } from './settings-index'

/** The settings the current search finds; null while nothing is typed. */
export const SearchHits = createContext<Set<SettingId> | null>(null)

export function useShown(id: SettingId): boolean {
  const hits = useContext(SearchHits)
  return !hits || hits.has(id)
}

/** One setting, labelled from settings-index. A search that doesn't find it hides it. `sub`: part of the row above. */
export function SettingRow({ id, line, control, sub, children }: { id: SettingId; line?: ReactNode; control?: ReactNode; sub?: boolean; children?: ReactNode }) {
  if (!useShown(id)) return null
  return (
    <div className={`srow${sub ? ' sub' : ''}`} data-setting={id}>
      <div className="srow-main">
        <div className="srow-t">
          <b id={`set-${id}`}>{SETTINGS[id].label}</b>
          {line != null && <span>{line}</span>}
        </div>
        {control}
      </div>
      {children}
    </div>
  )
}

export function Switch({ on, disabled, labelledBy, onToggle, testid }: { on: boolean; disabled?: boolean; labelledBy: string; onToggle: () => void; testid: string }) {
  return (
    <button className="switch" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled} onClick={onToggle} data-testid={testid}>
      <i />
    </button>
  )
}
