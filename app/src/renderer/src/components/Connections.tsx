import { useEffect, useRef, useState } from 'react'
import type { ConnectionInfo, ConnectionKind, ProviderInfo, SaveConnectionResult } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Button, Spinner } from './ui'
import { Icon } from './icons'
import { ConnectedMark, ProviderRow } from './provider-row'

const KINDS: { kind: ConnectionKind; label: string }[] = [
  { kind: 'openai', label: 'OpenAI-compatible' },
  { kind: 'anthropic', label: 'Anthropic-compatible' }
]
const ADDRESS_EXAMPLE: Record<ConnectionKind, string> = { openai: 'http://127.0.0.1:4000/v1', anthropic: 'http://127.0.0.1:4000' }
const ADDRESS_HELP: Record<ConnectionKind, string> = { openai: 'Usually ends in /v1.', anthropic: 'Usually without /v1 at the end.' }
type Field = NonNullable<NonNullable<SaveConnectionResult['error']>['field']>

/**
 * Your own AI server: one row with Set up until a server is saved, then each saved one under it. The form opens in
 * place under the row, one field per line, so it fits a narrow column; nothing here opens a dialog over the window.
 * CLIProxyAPI, found by the app, has its own row and is not listed here.
 */
export function Connections({ onConnected }: { onConnected: (p: ProviderInfo) => void }) {
  const [list, setList] = useState<ConnectionInfo[] | null>(null)
  const [editing, setEditing] = useState<ConnectionInfo | 'new' | null>(null)
  const [removing, setRemoving] = useState<ConnectionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    reel.ai
      .connections()
      .then((l) => setList(l.filter((c) => c.kind !== 'cliproxy')))
      .catch(() => setList([]))
  useEffect(() => {
    void load()
  }, [])

  const use = async (c: ConnectionInfo) => {
    setError(null)
    try {
      await reel.ai.setActive('custom', c.id)
      await load()
      onConnected(await reel.ai.active())
    } catch (e) {
      setError(userMessage(e))
    }
  }
  const setImages = async (c: ConnectionInfo, on: boolean) => {
    setError(null)
    try {
      await reel.ai.setConnectionImages(c.id, on)
    } catch (e) {
      setError(userMessage(e))
    }
    await load()
  }
  const remove = async (c: ConnectionInfo) => {
    setRemoving(null)
    try {
      await reel.ai.removeConnection(c.id)
    } catch (e) {
      setError(userMessage(e))
    }
    await load()
  }

  if (!list) return null
  return (
    <>
      <ProviderRow
        setting="own-server"
        mark={<Icon name="server" size={20} />}
        status={list.length ? `${list.length} saved` : 'Not set up'}
        action={
          editing === 'new' ? null : (
            <Button size="small" onClick={() => setEditing('new')} aria-expanded={false} data-testid={list.length ? 'connection-add' : 'own-server-toggle'}>
              {list.length ? 'Add another' : 'Set up'}
            </Button>
          )
        }
      >
        {editing === 'new' && (
          <ConnectionForm
            editing={null}
            onClose={() => setEditing(null)}
            onSaved={(status) => {
              setEditing(null)
              void load()
              onConnected(status)
            }}
          />
        )}
        {list.length > 0 && (
          <ul className="pv-subs" data-testid="connections">
            {list.map((c) => (
              <li key={c.id} className="pv-sub" data-testid="connection-card">
                <div className="pv-sub-main">
                  <div className="pv-t">
                    <b className="conn-line" title={c.label}>{c.label}</b>
                    <span className={`pv-status conn-line ${c.active ? 'ok' : 'plain'}`} title={`${c.model} · ${c.baseURL}`}>
                      {c.active ? <ConnectedMark /> : `${c.model} · ${c.baseURL}`}
                    </span>
                  </div>
                  {!c.active && (
                    <Button size="small" onClick={() => void use(c)} data-testid="connection-use">
                      Use it
                    </Button>
                  )}
                </div>
                <div className="conn-acts">
                  <button className="link inline" onClick={() => setEditing(c)} aria-label={`Edit ${c.label}`} data-testid="connection-edit">
                    Edit
                  </button>
                  <button className="link inline danger" onClick={() => setRemoving(c)} aria-label={`Remove ${c.label}`} data-testid="connection-remove">
                    Remove
                  </button>
                </div>
                {removing?.id === c.id && (
                  <div className="conn-confirm" role="group" aria-label={`Remove ${c.label}?`} data-testid="confirm">
                    <p>
                      Reel Studio forgets this server and its key.{c.active ? ' Reels get a basic version until you connect an editor again.' : ''}
                    </p>
                    <div className="row">
                      <Button size="small" kind="tertiary" onClick={() => setRemoving(null)} autoFocus data-testid="confirm-no">
                        Keep it
                      </Button>
                      <Button size="small" danger onClick={() => void remove(c)} data-testid="confirm-yes">
                        Remove
                      </Button>
                    </div>
                  </div>
                )}
                {editing && editing !== 'new' && editing.id === c.id && (
                  <ConnectionForm
                    editing={c}
                    onClose={() => setEditing(null)}
                    onSaved={(status) => {
                      setEditing(null)
                      void load()
                      onConnected(status)
                    }}
                  />
                )}
                <label className="toggle conn-images">
                  <input type="checkbox" checked={c.supportsImages} onChange={(e) => void setImages(c, e.target.checked)} data-testid="connection-images" />
                  Can see pictures
                  {!c.supportsImages && <span className="muted-sm">It edits without looking at your video.</span>}
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="pv-note error" role="alert">
            {error}
          </p>
        )}
      </ProviderRow>
    </>
  )
}

function ConnectionForm({ editing, onClose, onSaved }: { editing: ConnectionInfo | null; onClose: () => void; onSaved: (p: ProviderInfo) => void }) {
  const [kind, setKind] = useState<ConnectionKind>(editing?.kind === 'anthropic' ? 'anthropic' : 'openai')
  const [baseURL, setBaseURL] = useState(editing?.baseURL ?? '')
  const [key, setKey] = useState('')
  const [model, setModel] = useState(editing?.model ?? '')
  const [label, setLabel] = useState(editing?.label ?? 'My server')
  const [models, setModels] = useState<string[] | null>(null)
  const [suggested, setSuggested] = useState<string | null>(null)
  const [needsKey, setNeedsKey] = useState(false)
  const [looking, setLooking] = useState(false)
  const [customModel, setCustomModel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null)
  const fields = useRef<Partial<Record<Field, HTMLInputElement | HTMLSelectElement | null>>>({})
  const lookedUp = useRef('')
  // a model list that answers late must not replace a model the person typed meanwhile
  const modelNow = useRef(model)
  modelNow.current = model
  const storedKey = !!editing?.hasKey && sameOrigin(editing.baseURL, baseURL)
  const modelList = !customModel && !!models?.length

  const lookForModels = async () => {
    const q = `${kind} ${baseURL.trim()} ${key.trim()}`
    if (!/^https?:\/\/\S+/.test(baseURL.trim()) || lookedUp.current === q) return
    lookedUp.current = q
    setLooking(true)
    const found = await reel.ai
      .connectionModels({ kind, baseURL: baseURL.trim(), key: key.trim() || undefined, id: editing?.id })
      .catch(() => ({ models: [], suggested: null, needsKey: false }))
    // the address, key or kind changed since: a later lookup owns the list
    if (lookedUp.current !== q) return
    setLooking(false)
    setModels(found.models)
    setSuggested(found.suggested)
    setNeedsKey(found.needsKey)
    if (found.suggested && !modelNow.current.trim()) setModel(found.suggested)
  }
  const forgetModels = () => {
    lookedUp.current = ''
    setLooking(false)
  }
  useEffect(() => {
    if (editing) void lookForModels()
  }, [])

  const showError = (text: string, field?: Field) => {
    setError({ text, field })
    if (field) requestAnimationFrame(() => fields.current[field]?.focus())
  }

  const save = async () => {
    if (busy) return
    if (!baseURL.trim()) return showError('Enter the server address.', 'address')
    if (!model.trim()) return showError(modelList ? 'Pick a model from the list.' : 'Enter a model name.', 'model')
    setBusy(true)
    setError(null)
    try {
      const r = await reel.ai.saveConnection({ ...(editing ? { id: editing.id } : {}), label: label.trim(), kind, baseURL: baseURL.trim(), model: model.trim(), key: key.trim() })
      if (r.error) showError(r.error.userMessage, r.error.field)
      else onSaved(r.status)
    } catch (e) {
      showError(userMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const invalid = (f: Field) => error?.field === f
  const change = (f: Field, set: (v: string) => void) => (v: string) => {
    set(v)
    if (error?.field === f) setError(null)
  }
  // The error replaces the field's help line, so it sits under the field the cursor moves to and the form keeps its height.
  const help = (f: Field, text: string) =>
    invalid(f) ? (
      <p key="error" id={`conn-${f}-help`} className="muted-sm field-error" role="alert" data-testid="connection-error">
        {error?.text}
      </p>
    ) : (
      <p key="help" id={`conn-${f}-help`} className="muted-sm" data-testid={`connection-${f}-help`}>
        {text}
      </p>
    )
  const bind = (f: Field) => (el: HTMLInputElement | HTMLSelectElement | null) => {
    fields.current[f] = el
  }

  return (
    <div className="pv-more conn-form" data-testid="connection-dialog" role="group" aria-labelledby="conn-title">
      <p className="conn-form-h">
        <b id="conn-title">{editing ? `Edit ${editing.label}` : 'Use your own AI server'}</b>
        <span>For a server you run or rent that works like ChatGPT’s or Claude’s.</span>
      </p>
      <form
        className="conn-fields"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <fieldset className="conn-kinds">
          <legend className="field-label">Kind of server</legend>
          {KINDS.map((k) => (
            <label key={k.kind} className={`radio${kind === k.kind ? ' on' : ''}`}>
              <input
                type="radio"
                name="conn-kind"
                checked={kind === k.kind}
                autoFocus={kind === k.kind}
                onChange={() => {
                  setKind(k.kind)
                  setModels(null)
                  forgetModels()
                }}
                data-testid={`connection-kind-${k.kind}`}
              />
              {k.label}
            </label>
          ))}
        </fieldset>

        <div className="stack" style={{ gap: 6 }}>
          <label className="field-label" htmlFor="conn-address">
            Server address
          </label>
          <input
            id="conn-address"
            ref={bind('address')}
            className="input"
            type="url"
            spellCheck={false}
            autoComplete="off"
            placeholder={ADDRESS_EXAMPLE[kind]}
            value={baseURL}
            aria-invalid={invalid('address')}
            aria-describedby="conn-address-help"
            onChange={(e) => {
              forgetModels()
              change('address', setBaseURL)(e.target.value)
            }}
            onBlur={() => void lookForModels()}
            data-testid="connection-address"
          />
          {help('address', ADDRESS_HELP[kind])}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label className="field-label" htmlFor="conn-key">
            Key
          </label>
          <input
            id="conn-key"
            ref={bind('key')}
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={storedKey ? 'Stored key. Enter a new one to replace it.' : kind === 'openai' ? 'Paste the key, if your server needs one' : 'Paste the key'}
            value={key}
            aria-invalid={invalid('key')}
            aria-describedby="conn-key-help"
            onChange={(e) => {
              forgetModels()
              change('key', setKey)(e.target.value)
            }}
            onBlur={() => void lookForModels()}
            data-testid="connection-key"
          />
          {help('key', 'Kept encrypted on this computer and never shown again.')}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ minHeight: 22 }}>
            <label className="field-label" htmlFor="conn-model">
              Model
            </label>
            {looking && (
              <span className="muted-sm row" style={{ gap: 6 }} role="status">
                <Spinner /> Looking for models…
              </span>
            )}
            <span className="spacer" />
            {modelList && (
              <button
                type="button"
                className="link inline"
                onClick={() => {
                  setCustomModel(true)
                  setModel('')
                  requestAnimationFrame(() => fields.current.model?.focus())
                }}
                data-testid="connection-custom-model"
              >
                Type a model name
              </button>
            )}
          </div>
          {modelList ? (
            <select
              id="conn-model"
              ref={bind('model')}
              className="input"
              style={{ maxWidth: 'none' }}
              value={model}
              aria-invalid={invalid('model')}
              aria-describedby="conn-model-help"
              onChange={(e) => change('model', setModel)(e.target.value)}
              data-testid="connection-model-list"
            >
              {!model && <option value="">Pick a model</option>}
              {/* a model the server does not list stays chosen, and visible, rather than saved unseen */}
              {(model && !models!.includes(model) ? [model, ...models!] : models!).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="conn-model"
              ref={bind('model')}
              className="input"
              spellCheck={false}
              autoComplete="off"
              placeholder="The model's name on your server"
              value={model}
              aria-invalid={invalid('model')}
              aria-describedby="conn-model-help"
              onChange={(e) => change('model', setModel)(e.target.value)}
              data-testid="connection-model"
            />
          )}
          {help(
            'model',
            modelList
              ? model && model === suggested
                ? 'Suggested: the newest model Reel Studio knows on this server.'
                : 'Pick the newest, largest model. The first one listed is often an old, small one.'
              : models && !models.length
                ? needsKey && !key.trim() && !storedKey
                  ? "Add the key to see this server's models."
                  : "No models reported by this server yet. Type the model's name."
                : "Type the model's name, or fill in the address to pick from a list."
          )}
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label className="field-label" htmlFor="conn-label">
            Name
          </label>
          <input
            id="conn-label"
            ref={bind('label')}
            className="input"
            value={label}
            maxLength={60}
            aria-invalid={invalid('label')}
            aria-describedby={invalid('label') ? 'conn-label-help' : undefined}
            onChange={(e) => change('label', setLabel)(e.target.value)}
            data-testid="connection-label"
          />
          {invalid('label') && help('label', '')}
        </div>

        {error && !error.field && (
          <div className="banner error" role="alert" data-testid="connection-error">
            <span>{error.text}</span>
          </div>
        )}
        {busy && <p className="muted-sm" role="status">Sending one short message to check it works.</p>}
        <div className="conn-buttons">
          <Button size="small" kind="tertiary" onClick={onClose} disabled={busy} data-testid="connection-cancel">
            Cancel
          </Button>
          <Button type="submit" size="small" kind="primary" disabled={busy} data-testid="connection-save">
            {busy ? (
              <>
                <Spinner /> Checking…
              </>
            ) : editing ? (
              'Save'
            ) : (
              'Connect'
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b.trim()).origin
  } catch {
    return false
  }
}
