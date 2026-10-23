import type { ProjectJson } from '../../../../shared/api'
import { CAPTION_PRESETS, applyPreset, lookFromStyle, presetOf } from '../../../../shared/caption-presets'
import { SubtitleSample } from '../../components/Player'
import { arrowPick, Segmented, tabStop } from '../../components/ui'
import { setP, type TabProps } from './controls'

type Captions = NonNullable<ProjectJson['captions']>
type Style = Record<string, unknown>

const SIZES = [
  { key: 'small', label: 'Small', size: 84 },
  { key: 'medium', label: 'Medium', size: 105 },
  { key: 'big', label: 'Big', size: 126 }
] as const
const POSITIONS = [
  { key: 'higher', label: 'Higher', position: 0.66 },
  { key: 'lower', label: 'Lower', position: 0.75 }
] as const
const COLORS = [
  { key: 'white', label: 'White', color: '#FFFFFF' },
  { key: 'yellow', label: 'Yellow', color: '#FFD60A' }
] as const
const HIGHLIGHTS = [
  { key: 'yellow', label: 'Yellow', color: '#FFD60A' },
  { key: 'green', label: 'Green', color: '#30D158' }
] as const

const sizeKey = (st: Style): string => {
  const n = Number(st.size ?? 105)
  return n < 95 ? 'small' : n > 115 ? 'big' : 'medium'
}
const positionKey = (st: Style): string => (Number(st.position ?? 0.75) < 0.69 ? 'higher' : 'lower')
const colorKey = (st: Style): string => (String(st.color ?? '#FFFFFF').toUpperCase() === '#FFFFFF' ? 'white' : 'yellow')
const highlightKey = (st: Style): string => HIGHLIGHTS.find((x) => x.color === String(st.highlight).toUpperCase())?.key ?? ''

const SWATCH_WIDTH = 56
const LOOK_KEYS = CAPTION_PRESETS.map((p) => p.key)

/** The looks to start from, each drawn on a small frame with two words of the reel. */
function Looks({ value, text, onPick }: { value: string | null; text: string; onPick: (k: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Look" data-testid="cap-look" onKeyDown={(e) => arrowPick(e, LOOK_KEYS, value, onPick)}>
      {CAPTION_PRESETS.map((o) => (
        <button
          key={o.key}
          role="radio"
          aria-checked={o.key === value}
          tabIndex={tabStop(o.key, value, LOOK_KEYS)}
          data-key={o.key}
          className={`swatch${o.key === value ? ' on' : ''}`}
          onClick={() => onPick(o.key)}
          data-testid={`cap-look-${o.key}`}
        >
          <span className="swatch-frame">
            <SubtitleSample look={{ ...lookFromStyle(o.style), position: 0.5 }} text={text} width={SWATCH_WIDTH} />
          </span>
          <span className="swatch-label">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export function SubtitlesTab({ now, change, next, sample }: TabProps & { sample: string }) {
  const captions: Captions = now.p.captions ?? { enabled: true }
  const style = (captions.style ?? {}) as Style
  const set = (fn: (c: Captions) => Captions) => change(setP((p) => ({ captions: fn(p.captions ?? { enabled: true }) })))
  const setStyle = (extra: Style) => set((c) => ({ ...c, style: { ...(c.style ?? {}), ...extra } }))
  const on = captions.enabled !== false

  return (
    <div className="edit-stack">
      <label className="toggle">
        <input type="checkbox" checked={on} onChange={(e) => set((c) => ({ ...c, enabled: e.target.checked }))} data-testid="subs-on" />
        Show subtitles
      </label>
      {on ? (
        <div className="edit-stack" data-testid="caption-controls">
          <div className="edit-field">
            <span className="edit-label">Look</span>
            {/* two words: a whole line shrinks to fit the small frame and can't be read */}
            <Looks value={presetOf(style)} text={sample.split(' ').slice(0, 2).join(' ')} onPick={(k) => set((c) => ({ ...c, style: applyPreset(k, (c.style ?? {}) as Style) }))} />
          </div>
          <div className="edit-field">
            <span className="edit-label">Size</span>
            <Segmented testid="cap-size" label="Size" value={sizeKey(style)} options={SIZES} onPick={(k) => setStyle({ size: SIZES.find((x) => x.key === k)!.size })} />
          </div>
          <div className="edit-field">
            <span className="edit-label">Position</span>
            <Segmented testid="cap-pos" label="Position" value={positionKey(style)} options={POSITIONS} onPick={(k) => setStyle({ position: POSITIONS.find((x) => x.key === k)!.position })} />
          </div>
          {style.highlight ? (
            <div className="edit-field">
              <span className="edit-label">Word being said</span>
              <Segmented testid="cap-highlight" label="Word being said" value={highlightKey(style)} options={HIGHLIGHTS} onPick={(k) => setStyle({ highlight: HIGHLIGHTS.find((x) => x.key === k)!.color })} />
            </div>
          ) : (
            <div className="edit-field">
              <span className="edit-label">Colour</span>
              <Segmented testid="cap-color" label="Colour" value={colorKey(style)} options={COLORS} onPick={(k) => setStyle({ color: COLORS.find((x) => x.key === k)!.color })} />
            </div>
          )}
          <p className="edit-hint">The phone shows a line of your reel in this look. The dashed frame is where Instagram's buttons don't cover the subtitles.</p>
        </div>
      ) : (
        <p className="edit-hint">Version {next} will have no words on the video.</p>
      )}
    </div>
  )
}
