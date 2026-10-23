import { useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryFile, ProjectJson } from '../../../../shared/api'
import { clock } from '../../../../shared/progress'
import {
  cutsHint,
  FADE_MAX,
  firstChoice,
  gainOf,
  gainText,
  JOBS,
  leadIn,
  momentAt,
  momentKey,
  momentWhy,
  musicFades,
  secondsText,
  SFX_GAIN,
  SFX_GAP,
  sfxName,
  sfxVolume,
  soundRows,
  takenMoments,
  type Join,
  type Sfx,
  type SfxMoment,
  type SoundRow,
  type SoundEffect,
  type VersionClock
} from '../../../../shared/sfx'
import { reel, userMessage } from '../../api'
import { useNotify } from '../../App'
import { Icon } from '../../components/icons'
import { byKeyboard, reducedMotion } from '../../components/motion'
import { arrowPick, IS_MAC, tabStop } from '../../components/ui'
import { usePlayhead } from '../../components/playhead'
import { fileTitle, setP, type TabProps } from './controls'
import { useAudition } from './preview'

const secondsSpoken = (v: number): string => `${Number(v.toFixed(2))} ${v === 1 ? 'second' : 'seconds'}`

const MUSIC_LEVELS = [
  { key: 'under-voice', label: 'Under my voice' },
  { key: 'quiet', label: 'Quiet' },
  { key: 'loud-intro', label: 'Loud at the start, then under my voice' }
]

let packOnce: Promise<SoundEffect[]> | null = null
export const soundPack = (): Promise<SoundEffect[]> => (packOnce ??= reel.sfx.pack())

export interface SoundTabProps extends TabProps {
  /** Where the version on screen plays each word, and its joins. */
  vclock: VersionClock
  joins: Join[]
  /** The sound picked here or on the timeline (its moment key). */
  selected: string | null
  onSelect: (key: string | null) => void
  /** Counts picks on the timeline, so picking the picked sound again still brings its row into view. */
  reveal: number
}

export function SoundTab({ d, base, now, change, settle, player, vclock, joins, selected, onSelect, reveal }: SoundTabProps) {
  const notify = useNotify()
  const [songs, setSongs] = useState<LibraryFile[] | null>(null)
  const [pack, setPack] = useState<SoundEffect[]>([])
  const [picking, setPicking] = useState<{ at: SfxMoment; t: number } | null>(null)
  const hear = useAudition()
  const music = now.p.music
  const sfx = now.p.sfx ?? []
  const second = usePlayhead(player.playhead, Math.round)
  const list = useRef<HTMLUListElement>(null)
  const addBtn = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useRef<string | null>(null)

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
  const said = (id: string) => d.words.find((w) => w.id === id)?.w
  const rows = soundRows(sfx, vclock, joins, now.p.broll, now.kept, said, byId)
  const here = momentAt(player.playhead.get(), vclock, joins, takenMoments(rows, vclock, now.kept))

  // a sound picked on the timeline scrolls into view
  useEffect(() => {
    if (!selected) return
    list.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() || byKeyboard() ? 'auto' : 'smooth' })
  }, [selected, reveal])
  // after an add or a removal, focus lands on a row rather than on the page
  useEffect(() => {
    const k = focusAfter.current
    if (k === null) return
    focusAfter.current = null
    const el = k ? list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"] .sfx-name`) : null
    ;(el ?? (addBtn.current?.disabled ? heading.current : addBtn.current))?.focus()
  })
  // While the picker is open, Escape closes it wherever focus is, before Edit it myself's own Escape sees it.
  useEffect(() => {
    if (!picking) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.modal-backdrop')) return
      e.preventDefault()
      closePicker()
    }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  })

  const setMusic = (m: Partial<NonNullable<ProjectJson['music']>>, key?: string) =>
    change(
      setP((p) => ({ music: { enabled: true, track: null, ...(p.music ?? {}), ...m } })),
      key
    )
  const setSfx = (fn: (list: Sfx[]) => Sfx[], key?: string) =>
    change(
      setP((p) => {
        const next = fn(p.sfx ?? [])
        return { sfx: next.length ? next : undefined }
      }),
      key
    )
  const put = (k: string, next: Sfx, key?: string) => setSfx((all) => all.map((x) => (momentKey(x.at) === k ? next : x)), key)
  const preview = (s: Sfx, restart = false) => {
    const p = byId.get(s.sound)
    if (p) hear.play(p.url, sfxVolume(s), { id: momentKey(s.at), restart })
  }
  const remove = (r: SoundRow) => {
    const i = rows.indexOf(r)
    focusAfter.current = rows[i + 1]?.key ?? rows[i - 1]?.key ?? ''
    if (selected === r.key) onSelect(null)
    setSfx((all) => all.filter((x) => momentKey(x.at) !== r.key))
  }
  const closePicker = () => {
    hear.stop()
    setPicking(null)
    focusAfter.current = ''
  }
  const add = (sound: string) => {
    if (!picking) return
    const k = momentKey(picking.at)
    setSfx((all) => [...all.filter((x) => momentKey(x.at) !== k), { at: picking.at, sound }])
    setPicking(null)
    onSelect(k)
    focusAfter.current = k
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
  // The saved song when it is not one of the Library's below (the editor found it elsewhere, or it left the
  // Library): its own row, named as the checklist names it, by its asset-ledger title and never the file's hash (#71).
  const saved = base.p.music?.track
  // until the Library is listed, a Library path counts as listed, so its row never flashes here
  const listed = (t: string): boolean => songs?.some((m) => t === `Library/Music/${m.name}`) ?? t.startsWith('Library/')
  const elsewhere = saved && !listed(saved) ? saved : null
  const fades = musicFades(music)
  const cuts = cutsHint(joins)
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
          {elsewhere && (
            <label className={`edit-row radio${!noMusic && music?.track === elsewhere ? ' on' : ''}`} data-testid="music-elsewhere">
              <input type="radio" name="track" checked={!noMusic && music?.track === elsewhere} onChange={() => setMusic({ enabled: true, track: elsewhere })} />
              <span className="edit-row-main">
                <span className="edit-row-title">{d.checklist.find((c) => c.key === 'music')?.detail}</span>
              </span>
            </label>
          )}
          {songs?.map((m) => {
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

      {(!noMusic || cuts) && (
        <section className="edit-field" aria-labelledby="fades-h" data-testid="fades">
          <h3 className="edit-label" id="fades-h">
            Fades
          </h3>
          {!noMusic && (
            <div className="edit-sliders">
              <Slider
                label="Music fade-in"
                value={Math.min(FADE_MAX, fades.fadeIn)}
                shown={secondsText(fades.fadeIn)}
                spoken={secondsSpoken(fades.fadeIn)}
                min={0}
                max={FADE_MAX}
                step={0.05}
                onChange={(v) => setMusic({ fadeIn: v }, 'fade-in')}
                onDone={settle}
                testid="fade-in"
              />
              <Slider
                label="Music fade-out"
                value={Math.min(FADE_MAX, fades.fadeOut)}
                shown={secondsText(fades.fadeOut)}
                spoken={secondsSpoken(fades.fadeOut)}
                min={0}
                max={FADE_MAX}
                step={0.05}
                onChange={(v) => setMusic({ fadeOut: v }, 'fade-out')}
                onDone={settle}
                testid="fade-out"
              />
            </div>
          )}
          {cuts && <p className="edit-hint">{cuts}</p>}
        </section>
      )}

      <section className="edit-field" aria-labelledby="sfx-h" data-testid="sfx">
        <h3 className="edit-label" id="sfx-h" ref={heading} tabIndex={-1}>
          Sound effects
        </h3>
        {rows.length === 0 ? (
          <p className="edit-hint">No sound effects in this reel yet.</p>
        ) : (
          <ul className="edit-list" aria-labelledby="sfx-h" ref={list}>
            {rows.map((r) => {
              const { s } = r
              const name = sfxName(s.sound)
              const sound = byId.get(s.sound)
              const playing = hear.playing === r.key
              const g = gainOf(s)
              return (
                <li key={r.key} data-key={r.key} className={`edit-row sfx-row${selected === r.key ? ' on' : ''}`} aria-current={selected === r.key || undefined} data-testid="sfx-row">
                  <div className="edit-row-main">
                    <div className="sfx-head">
                      <button
                        className="sfx-name"
                        aria-label={`${r.title}, ${r.why}`}
                        title={r.t === null ? undefined : 'Go to just before it'}
                        onClick={() => {
                          onSelect(r.key)
                          if (r.t !== null) player.seek(leadIn(r.t))
                        }}
                      >
                        <span className="edit-row-title tnum">{r.title}</span>
                        <span className="sfx-why"> · {r.why}</span>
                      </button>
                      <button className="icon-btn small" aria-label={`Remove ${r.title}`} onClick={() => remove(r)} data-testid="sfx-remove">
                        <Icon name="x" size={14} stroke={2} />
                      </button>
                    </div>
                    {r.warn && <span className="edit-row-sub warn">{r.warn}</span>}
                    <div className="sfx-controls">
                      <select
                        className="input select small"
                        aria-label={`Which ${name.kind.toLowerCase()} at ${r.t === null ? 'this moment' : clock(r.t)}`}
                        value={s.sound}
                        onChange={(e) => {
                          const next = { ...s, sound: e.target.value }
                          put(r.key, next)
                          preview(next, true)
                        }}
                      >
                        {JOBS.map((j) => (
                          <optgroup key={j.kind} label={`${j.name}, ${j.purpose}`}>
                            {pack
                              .filter((p) => p.kind === j.kind)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {j.name}, {sfxName(p.id).variant}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                        {!byId.has(s.sound) && <option value={s.sound}>{`${name.kind}, ${name.variant}`}</option>}
                      </select>
                      <button className="btn small" aria-label={`${playing ? 'Stop' : 'Play'} ${r.title}`} disabled={!sound} onClick={() => preview(s)} data-testid="sfx-preview">
                        <Icon name={playing ? 'pause' : 'play'} size={12} stroke={2} /> {playing ? 'Stop' : 'Play'}
                      </button>
                    </div>
                    <Slider
                      label="How loud"
                      aria={`How loud the ${name.kind.toLowerCase()}${r.t === null ? '' : ` at ${clock(r.t)}`} is`}
                      value={g}
                      shown={gainText(g)}
                      spoken={gainText(g).replace('−', 'minus ').replace('+', 'plus ').replace('dB', 'decibels')}
                      min={SFX_GAIN.min}
                      max={SFX_GAIN.max}
                      step={1}
                      onChange={(v) => {
                        const { gainDb: _old, ...rest } = s
                        put(r.key, v ? { ...rest, gainDb: v } : rest, `level:${r.key}`)
                      }}
                      onDone={(how) => {
                        settle()
                        if (how === 'pointer') preview(s, true)
                      }}
                      testid="sfx-level"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="edit-actions">
          <button
            ref={addBtn}
            className="btn small"
            aria-expanded={!!picking}
            aria-controls="sfx-picker"
            disabled={!here || !pack.length}
            onClick={() => (picking ? closePicker() : setPicking(here))}
            data-testid="sfx-add"
          >
            <Icon name="plus" size={14} /> Add a sound effect at <span className="tnum">{clock(picking?.t ?? here?.t ?? second)}</span>
          </button>
        </div>
        {!here && pack.length > 0 && vclock.placed.size > 0 && <p className="edit-hint">Every word from here to the end has a sound effect already.</p>}
        {picking && (
          <SoundPicker
            pack={pack}
            moment={picking}
            why={momentWhy(picking.at, said)}
            near={rows.find((r) => r.t !== null && !r.warn && Math.abs(r.t - picking.t) < SFX_GAP) ?? null}
            onPreview={(id) => {
              const p = byId.get(id)
              if (p) hear.play(p.url, 0.5, { id: `pick:${id}`, restart: true })
            }}
            onAdd={add}
            onCancel={closePicker}
          />
        )}
      </section>
    </div>
  )
}

/** A labelled slider with its value beside it. `onDone` runs when a drag or a key press ends. */
function Slider({
  label,
  aria,
  value,
  shown,
  spoken,
  min,
  max,
  step,
  onChange,
  onDone,
  testid
}: {
  label: string
  aria?: string
  value: number
  shown: string
  spoken: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  onDone: (how: 'pointer' | 'key') => void
  testid: string
}) {
  return (
    <label className="edit-slider">
      <span className="edit-slider-label">{label}</span>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={aria ?? label}
        aria-valuetext={spoken}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onDone('pointer')}
        onKeyUp={() => onDone('key')}
        data-testid={testid}
      />
      <output className="edit-slider-value tnum" aria-hidden>
        {shown}
      </output>
    </label>
  )
}

/** The sounds grouped by what they are for. A click plays one and picks it; Add puts it on the moment. */
function SoundPicker({
  pack,
  moment,
  why,
  near,
  onPreview,
  onAdd,
  onCancel
}: {
  pack: SoundEffect[]
  moment: { at: SfxMoment; t: number }
  why: string
  near: SoundRow | null
  onPreview: (id: string) => void
  onAdd: (id: string) => void
  onCancel: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [pick, setPick] = useState(() => (pack.some((p) => p.id === firstChoice(moment.at)) ? firstChoice(moment.at) : pack[0].id))
  const ids = JOBS.flatMap((j) => pack.filter((p) => p.kind === j.kind).map((p) => p.id))
  const choose = (id: string) => {
    setPick(id)
    onPreview(id)
  }
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    box.current?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() || byKeyboard() ? 'auto' : 'smooth' })
  }, [])
  const name = sfxName(pick)
  return (
    <div
      ref={box}
      id="sfx-picker"
      className="sfx-picker"
      role="group"
      aria-label={`Add a sound effect at ${clock(moment.t)}`}
      data-testid="sfx-picker"
    >
      <p className="sfx-picker-h">
        At <span className="tnum">{clock(moment.t)}</span>, {why}
      </p>
      <div className="sfx-jobs" role="radiogroup" aria-label="Which sound" onKeyDown={(e) => arrowPick(e, ids, pick, choose)}>
        {JOBS.map((j) => {
          const sounds = pack.filter((p) => p.kind === j.kind)
          if (!sounds.length) return null
          return (
            <div key={j.kind} className="sfx-job" role="group" aria-label={`${j.name}, ${j.purpose}`}>
              <span className="sfx-job-h" aria-hidden>
                <b>{j.name}</b> {j.purpose}
              </span>
              <span className="sfx-chips">
                {sounds.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={pick === p.id}
                    aria-label={`${j.name}, ${sfxName(p.id).variant}`}
                    tabIndex={tabStop(p.id, pick, ids)}
                    data-key={p.id}
                    className={`sfx-chip${pick === p.id ? ' on' : ''}`}
                    onClick={() => choose(p.id)}
                    data-testid={`sfx-choice-${p.id}`}
                  >
                    {sfxName(p.id).variant}
                  </button>
                ))}
              </span>
            </div>
          )
        })}
      </div>
      {near && (
        <p className="edit-row-sub warn">
          {near.title} is less than 2 seconds away. Only one sound plays in 2 seconds, so one of them will be left out.
        </p>
      )}
      <div className="sfx-picker-f">
        <button className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn small" onClick={() => onAdd(pick)} data-testid="sfx-picker-add">
          Add {name.kind.toLowerCase()}, {name.variant}
        </button>
      </div>
    </div>
  )
}

