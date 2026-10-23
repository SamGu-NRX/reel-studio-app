import { useEffect, useState } from 'react'
import { reel, userMessage } from '../api'

const PROVIDERS = [
  { id: 'pexels', label: 'Pexels', url: 'https://www.pexels.com/api/' },
  { id: 'pixabay', label: 'Pixabay', url: 'https://pixabay.com/api/docs/' }
] as const

export function StockKeys() {
  const [connected, setConnected] = useState<Set<string> | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    reel.ai.stockProviders().then(rows => setConnected(new Set(rows.filter(r => r.connected).map(r => r.id)))).catch(e => setError(userMessage(e)))
  }, [])
  const refresh = (id: string, on: boolean) => setConnected(previous => {
    const next = new Set(previous)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })
  return <section className="panel">
    <h2>Stock photos and footage</h2>
    <p className="muted" style={{ margin: '6px 0 14px' }}>Add free API keys to let your AI editor find stock media. Keys are stored securely on this computer. Openverse image search works without a key.</p>
    {error && <p role="alert">{error}</p>}
    {PROVIDERS.map(provider => <StockKey key={provider.id} provider={provider} connected={connected?.has(provider.id) ?? false} ready={connected !== null} onSaved={refresh} />)}
    <p className="muted-sm">Photos and videos provided by <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a> and <a href="https://pixabay.com" target="_blank" rel="noreferrer">Pixabay</a>. Image search also uses <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a>. Required credits are added to your post caption.</p>
  </section>
}

function StockKey({ provider, connected, ready, onSaved }: {
  provider: typeof PROVIDERS[number]; connected: boolean; ready: boolean; onSaved: (id: string, on: boolean) => void
}) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const save = async (value: string | null) => {
    setBusy(true); setError(''); setMessage('')
    try {
      await reel.ai.setStockKey(provider.id, value)
      setKey(''); onSaved(provider.id, !!value)
      setMessage(value ? 'Key saved. It will be checked when you search.' : 'Key removed.')
    } catch (e) { setError(userMessage(e)) }
    finally { setBusy(false) }
  }
  return <form style={{ marginBottom: 18 }} onSubmit={e => { e.preventDefault(); if (key.trim()) void save(key.trim()) }}>
    <label htmlFor={`stock-${provider.id}`}>{provider.label} API key</label>
    <p id={`stock-help-${provider.id}`} className="muted-sm" style={{ margin: '4px 0 8px' }}>{connected ? 'A key is saved. Paste a new key to replace it.' : 'No key saved. This provider is skipped.'} <a href={provider.url} target="_blank" rel="noreferrer">Get a free {provider.label} key</a></p>
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <input id={`stock-${provider.id}`} className="input" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby={`stock-help-${provider.id}`} disabled={busy || !ready} style={{ flex: '1 1 220px', minWidth: 0 }} />
      <button className="btn" type="submit" disabled={busy || !ready || !key.trim()}>{busy ? 'Saving…' : 'Save key'}</button>
      {connected && <button className="btn ghost" type="button" disabled={busy} onClick={() => void save(null)}>Remove key</button>}
    </div>
    <p role="status" className="muted-sm">{message}</p>
    {error && <p role="alert">{error}</p>}
  </form>
}
