// Settings › Advanced, under "Stock photos and footage": free API keys that let the AI editor search Pexels and
// Pixabay (stock-search). The AI package keeps each key in safe storage; the page only sends it once. Openverse image
// search needs no key, so it has no row. Drawn like the Anthropic key row above them; each row says only what the
// subhead doesn't.
import { useEffect, useState } from 'react'
import { reel, userMessage } from '../api'
import { Icon } from './icons'
import { ProviderRow } from './provider-row'
import { Spinner } from './ui'

const PROVIDERS = [
  { id: 'pexels', name: 'Pexels', url: 'https://www.pexels.com/api/' },
  { id: 'pixabay', name: 'Pixabay', url: 'https://pixabay.com/api/docs/' }
] as const
type StockId = (typeof PROVIDERS)[number]['id']

export function StockKeys() {
  const [saved, setSaved] = useState<Set<StockId> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    reel.ai
      .stockProviders()
      .then((rows) => setSaved(new Set(rows.filter((r) => r.connected && r.id !== 'openverse').map((r) => r.id as StockId))))
      .catch((e) => setError(userMessage(e)))
  }, [])
  const mark = (id: StockId, on: boolean) =>
    setSaved((was) => {
      const next = new Set(was)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  return (
    <>
      {PROVIDERS.map((p) => (
        <StockKey key={p.id} provider={p} saved={saved?.has(p.id) ?? false} ready={saved !== null} loadError={error} onSaved={mark} />
      ))}
    </>
  )
}

function StockKey({ provider, saved, ready, loadError, onSaved }: {
  provider: (typeof PROVIDERS)[number]
  saved: boolean
  ready: boolean
  loadError: string | null
  onSaved: (id: StockId, on: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (value: string | null) => {
    if (busy || (value !== null && !value.trim())) return
    setBusy(true)
    setError(null)
    try {
      await reel.ai.setStockKey(provider.id, value === null ? null : value.trim())
      setKey('')
      setOpen(false)
      onSaved(provider.id, value !== null)
    } catch (e) {
      setError(userMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const problem = error ?? loadError
  return (
    <ProviderRow
      id={provider.id}
      setting="stock-keys"
      name={provider.name}
      mark={<Icon name="key" size={20} />}
      tone={problem ? 'error' : saved ? 'ok' : 'plain'}
      status={problem ?? (saved ? 'Key saved. Your editor can search it.' : 'No key, so your editor skips it.')}
      action={
        !ready || open ? null : saved ? (
          <button className="btn small ghost" disabled={busy} onClick={() => void save(null)} data-testid={`stock-remove-${provider.id}`}>
            {busy && <Spinner />} Remove key
          </button>
        ) : (
          <button className="btn small" onClick={() => setOpen(true)} data-testid={`stock-add-${provider.id}`}>
            Add key
          </button>
        )
      }
    >
      {open && (
        <div className="pv-more">
          <div className="row">
            <input
              className="input"
              type="password"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder={`Paste your ${provider.name} API key`}
              aria-label={`${provider.name} API key`}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save(key)
                if (e.key === 'Escape') setOpen(false)
              }}
              data-testid={`stock-key-${provider.id}`}
            />
            <button className="btn small" onClick={() => void save(key)} disabled={!key.trim() || busy} data-testid={`stock-save-${provider.id}`}>
              {busy && <Spinner />} Save key
            </button>
          </div>
          <p className="muted-sm">
            Free from{' '}
            <a href={provider.url} target="_blank" rel="noreferrer">
              {provider.name}
            </a>
            . Credits the photos need are added to your post caption.
          </p>
        </div>
      )}
    </ProviderRow>
  )
}
