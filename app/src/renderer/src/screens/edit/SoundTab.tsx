import { useEffect, useMemo, useState } from 'react'
import type { LibraryFile, ProjectJson } from '../../../../shared/api'
import { clock } from '../../../../shared/progress'
import { kindName, levelOf, SFX_LEVELS, sfxName, sfxReason, sfxWord, type Sfx, type SoundEffect } from '../../../../shared/sfx'
import { reel, userMessage } from '../../api'
import { useNotify } from '../../App'
import { Icon } from '../../components/icons'
import { IS_MAC } from '../../components/ui'
import { usePlayhead } from '../../components/playhead'
import { fileTitle, Seg, setP, type TabProps } from './controls'
import { useAudition } from './preview'

const MUSIC_LEVELS = [
  { key: 'under-voice', label: 'Under my voice' },
  { key: 'quiet', label: 'Quiet' },
  { key: 'loud-intro', label: 'Loud at the start, then under my voice' }
]

/** The engine's one sound per two seconds (docs/schema-changes.md, sound effects). */
const SFX_GAP = 2

let packOnce: Promise<SoundEffect[]> | null = null
export const soundPack = (): Promise<SoundEffect[]> => (packOnce ??= reel.sfx.pack())

/** How loud a preview plays a sound, from its level: about half volume at Normal. */
export const sfxVolume = (s: Sfx): number => Math.min(1, 0.5 * 10 ** (Number(s.gainDb ?? 0) / 20))

const keyOf = (s: Sfx): string => JSON.stringify(s.at)

export function SoundTab({ d, now, change, player, placed }: TabProps) {
  const notify = useNotify()
  const [songs, setSongs] = useState<LibraryFile[]>([])
  const [pack, setPack] = useState<SoundEffect[]>([])
  const hear = useAudition()
  const music = now.p.music
  const sfx = now.p.sfx ?? []
  const second = usePlayhead(player.playhead, Math.floor)

  const loadSongs = () =>
    reel.library
      .list()
      .then((bins) => setSongs(bins.find((b) => b.key === 'music')?.files ?? []))
      .catch((e) => notify(userMessage(e), 'error'))
  useEffect(() => {
    void loadSongs()
    soundPack().then(setPack, (e) => notify(userMessage(e), 'error'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const byId = useMemo(() => new Map(pack.map((s) => [s.id, s])), [pack])
  const kinds = useMemo(() => [...new Set(pack.map((s) => s.kind))], [pack])
  const said = (id: string) => d.words.find((w) => w.id === id)?.w
  const timeOf = (s: Sfx): number | null => {
    const w = sfxWord(s, now.p.broll)
    return w ? (placed.get(w)?.s ?? null) : null
  }
  const rows = sfx.map((s) => ({ s, t: timeOf(s) })).sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity))

  const setMusic = (m: Partial<NonNullable<ProjectJson['music']>>) => change(setP((p) => ({ music: { enabled: true, track: null, ...(p.music ?? {}), ...m } })))
  const setSfx = (fn: (list: Sfx[]) => Sfx[]) =>
    change(setP((p) => {
      const list = fn(p.sfx ?? [])
      return { sfx: list.length ? list : undefined }
    }))
  const put = (s: Sfx, next: Sfx) => setSfx((list) => list.map((x) => (keyOf(x) === keyOf(s) ? next : x)))

  // a new sound goes on the word playing now, or the next one that has no sound yet
  const used = new Set(sfx.map(keyOf))
  const free = [...placed.values()].sort((a, b) => a.s - b.s).find((w) => w.e > second && !used.has(JSON.stringify({ word: w.id })))
  const add = () => {
    if (!free) return
    const first = pack[0]?.id ?? 'whoosh-quick'
    setSfx((list) => [...list, { at: { word: free.id }, sound: first }])
    const p = byId.get(first)
    if (p) hear.play(p.url, 0.5)
  }

  const chooseSong = async () => {
    try {
      const r = await reel.library.choose('music')
      await loadSongs()
      const name = r.find((x) => x.bin === 'music' && x.dest)?.dest?.split(/[\\/]/).pop()
      if (name) setMusic({ enabled: true, track: `Library/Music/${name}`, startAt: 0, level: music?.level ?? 'under-voice' })
    } catch (e) {
      notify(userMessage(e), 'error')
    }
  }

  const noMusic = !music?.track || music.enabled === false
  return (
    <div className="edit-stack">
      <section className="edit-field" aria-labelledby="music-h">
        <h3 className="edit-label" id="music-h">
          Music
        </h3>
        <div className="edit-list" role="radiogroup" aria-labelledby="music-h">
          <label className={`edit-row radio${noMusic ? ' on' : ''}`}>
            <input type="radio" name="track" checked={noMusic} onChange={() => setMusic({ enabled: false, track: null })} />
            <span className="edit-row-main">No music</span>
          </label>
          {songs.map((m) => {
            const rel = `Library/Music/${m.name}`
            const on = !noMusic && music?.track === rel
            return (
              <div key={m.path} className={`edit-row radio${on ? ' on' : ''}`}>
                <label className="edit-row-main">
                  <input type="radio" name="track" checked={on} onChange={() => setMusic({ enabled: true, track: rel, startAt: 0 })} />
                  <span className="edit-row-title">{fileTitle(m.name)}</span>
                </label>
                <button className="icon-btn small" aria-label={hear.playing === m.url ? `Stop ${fileTitle(m.name)}` : `Play ${fileTitle(m.name)}`} onClick={() => hear.play(m.url, 0.6)}>
                  <Icon name={hear.playing === m.url ? 'pause' : 'play'} size={14} stroke={2} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="edit-actions">
          <button className="btn small" onClick={() => void chooseSong()} data-testid="music-add">
            <Icon name="plus" size={14} /> Add a song from this {IS_MAC ? 'Mac' : 'PC'}
          </button>
        </div>
        {!noMusic && (
          <label className="edit-inline">
            <span className="edit-label">How loud</span>
            <select className="input select" value={music?.level ?? 'under-voice'} onChange={(e) => setMusic({ level: e.target.value })}>
              {MUSIC_LEVELS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <section className="edit-field" aria-labelledby="sfx-h" data-testid="sfx">
        <h3 className="edit-label" id="sfx-h">
          Sound effects
        </h3>
        {rows.length === 0 ? (
          <p className="edit-hint">No sound effects in this reel yet.</p>
        ) : (
          <ul className="edit-list" aria-labelledby="sfx-h">
            {rows.map(({ s, t }, i) => {
              const name = sfxName(s.sound)
              const sound = byId.get(s.sound)
              const close = i > 0 && t !== null && rows[i - 1].t !== null && t - rows[i - 1].t! < SFX_GAP
              const title = `${name.kind} at ${t === null ? '—' : clock(t)}`
              return (
                <li key={keyOf(s)} className="edit-row sfx-row" data-testid="sfx-row">
                  <button
                    className="icon-btn small"
                    aria-label={`Hear ${title}`}
                    onClick={() => (t === null ? sound && hear.play(sound.url, sfxVolume(s)) : player.seek(Math.max(0, t - 1.5), true))}
                  >
                    <Icon name="play" size={14} stroke={2} />
                  </button>
                  <div className="edit-row-main">
                    <span className="edit-row-title tnum">{title}</span>
                    <span className="edit-row-sub">
                      {sfxReason(s, said)}
                      {t === null && ', a word this version leaves out'}
                    </span>
                    <div className="sfx-controls">
                      <select
                        className="input select small"
                        aria-label={`Which ${name.kind.toLowerCase()}`}
                        value={s.sound}
                        onChange={(e) => {
                          put(s, { ...s, sound: e.target.value })
                          const p = byId.get(e.target.value)
                          if (p) hear.play(p.url, sfxVolume(s))
                        }}
                      >
                        {kinds.map((k) => (
                          <optgroup key={k} label={kindName(k)}>
                            {pack
                              .filter((p) => p.kind === k)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {kindName(k)}, {sfxName(p.id).variant}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                        {!byId.has(s.sound) && <option value={s.sound}>{`${name.kind}, ${name.variant}`}</option>}
                      </select>
                      <Seg
                        testid="sfx-level"
                        label={`How loud the ${name.kind.toLowerCase()} is`}
                        value={levelOf(s)}
                        options={SFX_LEVELS}
                        onPick={(k) => {
                          const g = SFX_LEVELS.find((x) => x.key === k)!.gainDb
                          const { gainDb: _old, ...rest } = s
                          put(s, g ? { ...rest, gainDb: g } : rest)
                        }}
                      />
                    </div>
                    {close && <span className="edit-row-sub warn">Within 2 seconds of the sound before it, so it won't play. Remove one of them.</span>}
                  </div>
                  <button className="icon-btn small" aria-label={`Remove ${title}`} onClick={() => setSfx((list) => list.filter((x) => keyOf(x) !== keyOf(s)))}>
                    <Icon name="x" size={14} stroke={2} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="edit-actions">
          <button className="btn small" onClick={add} disabled={!free || !pack.length} data-testid="sfx-add">
            <Icon name="plus" size={14} /> Add a sound at <span className="tnum">{clock(free?.s ?? second)}</span>
          </button>
        </div>
      </section>
    </div>
  )
}
