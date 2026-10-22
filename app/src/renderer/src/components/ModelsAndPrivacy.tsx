import { useEffect, useRef, useState } from 'react'
import type { AppInfo, DataSharing, ModelChoice, ModelRole, ProviderInfo } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Icon } from './icons'
import { PopMenu } from './PopMenu'

const ROLES: [ModelRole, string, string][] = [
  ['editor', 'Editor', 'Makes the edits you ask for.'],
  ['checker', 'Checker', 'Looks over every edit on its own before it’s saved.'],
  ['writer', 'Writer', 'Writes titles, version summaries and status lines. A small, fast model is enough.']
]

/** The models a connection says it has. Only your own server lists them; Claude and ChatGPT pick their own. */
async function offeredModels(p: ProviderInfo | null): Promise<string[]> {
  if (!p || p.id !== 'custom' || !p.connectionId) return []
  const c = (await reel.ai.connections()).find((x) => x.id === p.connectionId)
  if (!c) return []
  return (await reel.ai.connectionModels({ kind: c.kind, baseURL: c.baseURL, id: c.id })).models
}

/**
 * Settings › Your AI editor › Models: one folded row; open, a row per role, each Auto unless you pick one.
 * The choices are saved; the AI editor does not read them yet, and the footnote says so.
 */
export function Models({ info, onInfo, onError }: { info: AppInfo; onInfo: (i: AppInfo) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const [offered, setOffered] = useState<string[]>([])
  const [menu, setMenu] = useState<ModelRole | null>(null)
  const anchors = useRef<Partial<Record<ModelRole, HTMLButtonElement | null>>>({})
  const anchor = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    let live = true
    const read = (p: ProviderInfo) => {
      setProvider(p)
      offeredModels(p)
        .then((m) => live && setOffered(m))
        .catch(() => live && setOffered([]))
    }
    reel.ai.active().then(read).catch(() => {})
    const off = reel.ai.onChange(read)
    return () => {
      live = false
      off()
    }
  }, [])

  if (!provider || !provider.connected || provider.id === 'none') return null
  const m = info.models
  const gone = (r: ModelRole) => m[r] !== 'auto' && !offered.includes(m[r])
  const label = (r: ModelRole) => (m[r] === 'auto' ? 'Auto' : m[r])
  const summary = ROLES.map(([r, name]) => `${name} ${label(r)}`).join(' · ')
  const pick = async (r: ModelRole, v: string) => {
    setMenu(null)
    anchors.current[r]?.focus()
    try {
      onInfo(await reel.app.setModels({ ...m, [r]: v } as ModelChoice))
    } catch (e) {
      onError(userMessage(e))
    }
  }

  return (
    <div className={`adv${open ? ' open' : ''}`} data-testid="models">
      <button className="advh" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tt">
          <b>Models</b>
          <span>
            {ROLES.some(([r]) => gone(r)) && <i className="wdot" aria-hidden />}
            {summary}
          </span>
        </span>
        <Icon name="chevron-down" size={14} className="chev" />
      </button>
      <div className={`acc${open ? ' open' : ''}`} inert={!open || undefined}>
        <div>
          <div className="mrows">
            {ROLES.map(([r, name, line]) => (
              <div className="mrow" key={r}>
                <div className="mt">
                  <b id={`mr-${r}`}>{name}</b>
                  <span>{line}</span>
                  {gone(r) && (
                    <p className="mnote warn">
                      <Icon name="alert" size={14} />
                      {m[r]} isn’t offered by your connection right now, so Auto is used instead.
                    </p>
                  )}
                </div>
                <button
                  ref={(el) => {
                    anchors.current[r] = el
                  }}
                  className={`mpick${gone(r) ? ' warn' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={menu === r}
                  aria-labelledby={`mr-${r} mpv-${r}`}
                  onClick={(e) => {
                    anchor.current = e.currentTarget
                    setMenu(menu === r ? null : r)
                  }}
                  data-testid={`model-${r}`}
                >
                  <span id={`mpv-${r}`}>{label(r)}</span>
                  <Icon name="updown" size={14} />
                </button>
                {menu === r && (
                  <PopMenu open onClose={() => setMenu(null)} anchor={anchor} label={`${name} model`} style={{ right: 0, top: 'calc(100% - 6px)', width: 240 }} origin="top right">
                    <button className="mi" role="menuitemradio" aria-checked={m[r] === 'auto'} onClick={() => void pick(r, 'auto')}>
                      {m[r] === 'auto' ? <Icon name="check" size={16} /> : <span className="mi-sp" />}
                      Auto
                    </button>
                    {offered.length > 0 && <hr />}
                    {offered.map((x) => (
                      <button key={x} className="mi" role="menuitemradio" aria-checked={m[r] === x} onClick={() => void pick(r, x)}>
                        {m[r] === x ? <Icon name="check" size={16} /> : <span className="mi-sp" />}
                        {x}
                      </button>
                    ))}
                    {!offered.length && (
                      <button className="mi" role="menuitemradio" aria-checked={false} disabled>
                        <span className="mi-sp" />
                        {provider.id === 'custom' ? 'Your server lists no models' : 'Picks its own models'}
                      </button>
                    )}
                  </PopMenu>
                )}
              </div>
            ))}
          </div>
          <p className="mfoot">Saved on this computer. For now your AI editor still picks its own models, whatever is set here.</p>
        </div>
      </div>
    </div>
  )
}

const PARTS: [keyof Omit<DataSharing, 'asked' | 'on'>, string, string][] = [
  ['usage', 'Usage', 'Which features you use, and errors.'],
  ['quality', 'Edit quality', 'A score for each edit: kept, changed or undone.'],
  ['posts', 'Post results', 'View counts of reels you’ve posted. Nothing else.']
]

export const NEVER_SHARED = 'Never your videos, words, notes or file names.'

function Switch({ on, disabled, labelledBy, onToggle, testid }: { on: boolean; disabled?: boolean; labelledBy: string; onToggle: () => void; testid: string }) {
  return (
    <button className="switch" role="switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled} onClick={onToggle} data-testid={testid}>
      <i />
    </button>
  )
}

/** Settings › Privacy: one switch for sharing, then what to share. Only the choice is saved; nothing is sent. */
export function Privacy({ info, onInfo, onError }: { info: AppInfo; onInfo: (i: AppInfo) => void; onError: (m: string) => void }) {
  const s = info.sharing
  const set = async (patch: Partial<DataSharing>) => {
    try {
      onInfo(await reel.app.setSharing({ ...s, asked: true, ...patch }))
    } catch (e) {
      onError(userMessage(e))
    }
  }
  return (
    <div className="privacy" data-testid="privacy">
      <div className="prow-m">
        <div className="pt">
          <b id="pv-all">Share anonymous data to help improve Reel Studio</b>
          <span className="never">
            <Icon name="lock" size={14} />
            {NEVER_SHARED}
          </span>
        </div>
        <Switch on={s.on} labelledBy="pv-all" onToggle={() => void set({ on: !s.on })} testid="share-on" />
      </div>
      <div className={`psubs${s.on ? '' : ' off'}`} role="group" aria-label="What's shared">
        {PARTS.map(([k, name, line]) => (
          <div className="psub" key={k}>
            <div className="pt">
              <b id={`pv-${k}`}>{name}</b>
              <span>{line}</span>
            </div>
            <Switch on={s.on && s[k]} disabled={!s.on} labelledBy={`pv-${k}`} onToggle={() => void set({ [k]: !s[k] })} testid={`share-${k}`} />
          </div>
        ))}
      </div>
      <p className="pfoot">
        {s.on ? 'Nothing is sent yet. When it is, it goes with no account or name attached.' : 'Nothing is shared. Turn this on to choose what to share.'}
      </p>
    </div>
  )
}
