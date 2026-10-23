import { useEffect, useRef, useState } from 'react'
import type { AppInfo, DataSharing, ModelChoice, ModelRole, ProviderInfo } from '../../../shared/api'
import { reel, userMessage } from '../api'
import { Icon } from './icons'
import { PopMenu } from './PopMenu'
import { useActiveEditor } from './connect'
import { SettingRow, Switch, useShown } from './settings-rows'
import type { SettingId } from './settings-index'

// What each role does in this build (ai editor.ts): the line says only that.
const ROLES: [ModelRole, SettingId, string][] = [
  ['editor', 'model-edits', 'Makes Version 1 and the changes in your notes.'],
  ['checker', 'model-checks', 'Proofreads Version 1’s subtitles against what you said.'],
  ['writer', 'model-titles', 'Writes scripts and their titles, and a caption the editor left out. A small, fast model is enough.']
]

/** Claude Code's model names, as `claude --help` lists them for `--model` (2.1.308). */
const CLAUDE_CODE_MODELS = ['fable', 'opus', 'sonnet']

const shown = (m: string): string => (CLAUDE_CODE_MODELS.includes(m) ? m[0].toUpperCase() + m.slice(1) : m)

/** The models the editor in use can be asked for. ChatGPT and an API key pick their own, so they list none. */
async function offeredModels(p: ProviderInfo | null): Promise<string[]> {
  if (!p?.connected) return []
  if (p.id === 'claude-cli') return CLAUDE_CODE_MODELS
  if (p.id !== 'custom' || !p.connectionId) return []
  const c = (await reel.ai.connections()).find((x) => x.id === p.connectionId)
  if (!c) return []
  return (await reel.ai.connectionModels({ kind: c.kind, baseURL: c.baseURL, id: c.id })).models
}

/**
 * Settings › Editor › Advanced: a model per role, each Auto unless you pick one the editor offers. Each job reads them
 * as it starts (ai index.ts modelForRole); ChatGPT and a Claude key pick their own model.
 */
export function Models({ info, onInfo, onError }: { info: AppInfo; onInfo: (i: AppInfo) => void; onError: (m: string) => void }) {
  const [provider] = useActiveEditor()
  const [offered, setOffered] = useState<string[]>([])
  const [menu, setMenu] = useState<ModelRole | null>(null)
  const anchors = useRef<Partial<Record<ModelRole, HTMLButtonElement | null>>>({})
  const anchor = useRef<HTMLButtonElement | null>(null)
  const anyShown = [useShown('model-edits'), useShown('model-checks'), useShown('model-titles')].some(Boolean)

  const editor = !!provider?.connected && provider.id !== 'none'
  useEffect(() => {
    let live = true
    setMenu(null)
    setOffered([])
    offeredModels(provider)
      .then((m) => live && setOffered(m))
      .catch(() => live && setOffered([]))
    return () => {
      live = false
    }
  }, [provider])

  const m = info.models
  const gone = (r: ModelRole) => editor && m[r] !== 'auto' && !offered.includes(m[r])
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
    <div className="models" data-testid="models">
      {anyShown && <h3 className="ssub">Models</h3>}
      {ROLES.map(([r, id, line]) => (
        <SettingRow
          key={r}
          id={id}
          line={
            <>
              {editor ? line : `${line} Choose an editor first.`}
              {gone(r) && (
                <span className="mnote warn">
                  <Icon name="alert" size={14} />
                  {shown(m[r])} isn’t offered by your editor right now.
                </span>
              )}
            </>
          }
          control={
            <span className="mpick-at">
              <button
                ref={(el) => {
                  anchors.current[r] = el
                }}
                className={`mpick${gone(r) ? ' warn' : ''}`}
                aria-haspopup="menu"
                aria-expanded={menu === r}
                aria-labelledby={`set-${id} mpv-${r}`}
                disabled={!editor}
                onClick={(e) => {
                  anchor.current = e.currentTarget
                  setMenu(menu === r ? null : r)
                }}
                data-testid={`model-${r}`}
              >
                <span id={`mpv-${r}`}>{m[r] === 'auto' ? 'Auto' : shown(m[r])}</span>
                <Icon name="updown" size={14} />
              </button>
              {menu === r && (
                <PopMenu open onClose={() => setMenu(null)} anchor={anchor} label="Model" style={{ right: 0, top: 'calc(100% + 6px)', width: 240 }} origin="top right">
                  <button className="mi" role="menuitemradio" aria-checked={m[r] === 'auto'} onClick={() => void pick(r, 'auto')}>
                    {m[r] === 'auto' ? <Icon name="check" size={16} /> : <span className="mi-sp" />}
                    Auto
                  </button>
                  {offered.length > 0 && <hr />}
                  {offered.map((x) => (
                    <button key={x} className="mi" role="menuitemradio" aria-checked={m[r] === x} onClick={() => void pick(r, x)}>
                      {m[r] === x ? <Icon name="check" size={16} /> : <span className="mi-sp" />}
                      {shown(x)}
                    </button>
                  ))}
                  {!offered.length && (
                    <button className="mi" role="menuitemradio" aria-checked={false} disabled>
                      <span className="mi-sp" />
                      {provider?.id === 'custom' ? 'Your server lists no models' : 'This editor picks its own model'}
                    </button>
                  )}
                </PopMenu>
              )}
            </span>
          }
        />
      ))}
      {anyShown && <p className="srow-foot">Auto lets your editor choose. A change applies from the next version made.</p>}
    </div>
  )
}

const PARTS: [keyof Omit<DataSharing, 'asked' | 'on'>, SettingId, string][] = [
  ['usage', 'sharing-usage', 'Which features you use, and errors.'],
  ['quality', 'sharing-quality', 'A score for each edit: kept, changed or undone.'],
  ['posts', 'sharing-posts', 'View counts of reels you’ve posted. Nothing else.']
]

export const NEVER_SHARED = 'Never your videos, words, notes or file names.'

/** Settings › Privacy: one switch for sharing, then what to share. Only the choice is saved; nothing is sent. */
export function Privacy({ info, onInfo, onError }: { info: AppInfo; onInfo: (i: AppInfo) => void; onError: (m: string) => void }) {
  const s = info.sharing
  const master = useShown('sharing')
  const set = async (patch: Partial<DataSharing>) => {
    try {
      onInfo(await reel.app.setSharing({ ...s, asked: true, ...patch }))
    } catch (e) {
      onError(userMessage(e))
    }
  }
  return (
    <div className={`privacy${s.on ? '' : ' off'}`} data-testid="privacy">
      <SettingRow
        id="sharing"
        line={
          <span className="never">
            <Icon name="lock" size={14} />
            {NEVER_SHARED}
          </span>
        }
        control={<Switch on={s.on} labelledBy="set-sharing" onToggle={() => void set({ on: !s.on })} testid="share-on" />}
      />
      {PARTS.map(([k, id, line]) => (
        <SettingRow key={k} id={id} sub line={line} control={<Switch on={s.on && s[k]} disabled={!s.on} labelledBy={`set-${id}`} onToggle={() => void set({ [k]: !s[k] })} testid={`share-${k}`} />} />
      ))}
      {master && <p className="srow-foot">{s.on ? 'Nothing is sent yet. When it is, it goes with no account or name attached.' : 'Nothing is shared. Turn this on to choose what to share.'}</p>}
    </div>
  )
}
