// Settings is rows and hairlines (ux-foundation-b.md section 9): a label, one line under it, a control on the right.
import { createContext, useContext, type ReactNode } from 'react'
import { matchedSynonym, matchRanges, SETTINGS, type SettingId } from './settings-index'

/** The settings the current search finds; null while nothing is typed. */
export const SearchHits = createContext<Set<SettingId> | null>(null)
/** What is typed in the search, for highlighting; '' while nothing is. */
const SearchQuery = createContext('')

/** What a search found and what was typed, for every row under it. */
export function SearchScope({ hits, query, children }: { hits: Set<SettingId> | null; query: string; children: ReactNode }) {
  return (
    <SearchHits.Provider value={hits}>
      <SearchQuery.Provider value={hits ? query : ''}>{children}</SearchQuery.Provider>
    </SearchHits.Provider>
  )
}

export function useShown(id: SettingId): boolean {
  const hits = useContext(SearchHits)
  return !hits || hits.has(id)
}

/** `text` with the words the search matched marked. */
export function Marked({ text }: { text: string }) {
  const query = useContext(SearchQuery)
  const ranges = matchRanges(text, query)
  if (!ranges.length) return <>{text}</>
  const out: ReactNode[] = []
  let at = 0
  for (const [a, b] of ranges) {
    if (a > at) out.push(text.slice(at, a))
    out.push(<mark key={a}>{text.slice(a, b)}</mark>)
    at = b
  }
  if (at < text.length) out.push(text.slice(at))
  return <>{out}</>
}

/** A setting's label from settings-index, marked; with the synonym that found it when the label doesn't say it. */
export function SettingLabel({ id }: { id: SettingId }) {
  const query = useContext(SearchQuery)
  const synonym = query ? matchedSynonym(id, query) : null
  return (
    <>
      <Marked text={SETTINGS[id].label} />
      {synonym && (
        <span className="smatch" aria-hidden="true" data-testid="search-synonym">
          <Marked text={synonym} />
        </span>
      )}
    </>
  )
}

/** One setting, labelled from settings-index. A search that doesn't find it hides it. `sub`: part of the row above. */
export function SettingRow({ id, line, control, sub, children }: { id: SettingId; line?: ReactNode; control?: ReactNode; sub?: boolean; children?: ReactNode }) {
  if (!useShown(id)) return null
  return (
    <div className={`srow${sub ? ' sub' : ''}`} data-setting={id}>
      <div className="srow-main">
        <div className="srow-t">
          <b id={`set-${id}`}>
            <SettingLabel id={id} />
          </b>
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
