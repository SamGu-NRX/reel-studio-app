// The two menus in the Reel screen's transport row, also in the full-screen stage: the playback speed and the
// phone shape the preview takes. Each is a pill that opens a small menu of choices and gives focus back to its pill,
// whose name then says the new choice. The shape also says aloud what Instagram may trim on that phone.
import { useRef, useState, type CSSProperties } from 'react'
import { SHAPES, fitWords } from '../../../shared/phone-shapes'
import { Icon } from './icons'
import { PopMenu } from './PopMenu'
import { usePhoneShape } from './Phone'
import { RATES, rateLabel, useTransport, type Transport } from './transport'
import { announce } from './announce'
import './preview.css'

/** Where a menu opens: up and to the left of its pill under the phone, up and to the right in the stage's dock. */
type Side = 'left' | 'right'
const above = (side: Side, width: number | string): { style: CSSProperties; origin: string } =>
  side === 'left' ? { style: { right: 0, bottom: 'calc(100% + 6px)', width }, origin: 'bottom right' } : { style: { left: 0, bottom: 'calc(100% + 6px)', width }, origin: 'bottom left' }

export function SpeedMenu({ transport, side = 'left' }: { transport: Transport; side?: Side }) {
  const { rate } = useTransport(transport)
  const [open, setOpen] = useState(false)
  const pill = useRef<HTMLButtonElement>(null)
  const pick = (r: number) => {
    transport.setRate(r)
    setOpen(false)
    pill.current?.focus({ preventScroll: true })
  }
  return (
    <span className="tmenu">
      <button
        ref={pill}
        type="button"
        className={`speed${rate !== 1 ? ' on' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Playback speed, ${rateLabel(rate)}`}
        title="Playback speed (< slower, > faster)"
        onClick={() => setOpen((o) => !o)}
        data-testid="speed"
      >
        {rateLabel(rate)}
      </button>
      <PopMenu open={open} onClose={() => setOpen(false)} anchor={pill} label="Playback speed" {...above(side, 140)} testid="speed-menu">
        {RATES.map((r) => (
          <button key={r} type="button" className="mi" role="menuitemradio" aria-checked={r === rate} onClick={() => pick(r)} data-testid={`speed-${r}`}>
            {r === rate ? <Icon name="check" size={16} /> : <span className="mi-sp" />}
            {rateLabel(r)}
            {r === 1 && <span className="r">Normal</span>}
          </button>
        ))}
      </PopMenu>
    </span>
  )
}

export function ShapeMenu({ side = 'left' }: { side?: Side }) {
  const [shape, setShape] = usePhoneShape()
  const [open, setOpen] = useState(false)
  const pill = useRef<HTMLButtonElement>(null)
  return (
    <span className="tmenu shape">
      <button
        ref={pill}
        type="button"
        className="tpill shape-pick"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Phone shape, ${shape.label}`}
        title={`${shape.label}. ${fitWords(shape)}`}
        onClick={() => setOpen((o) => !o)}
        data-testid="shape"
      >
        <Icon name="phone" size={16} stroke={1.75} />
        <span className="lbl">{shape.label}</span>
      </button>
      <PopMenu open={open} onClose={() => setOpen(false)} anchor={pill} label="Phone shape" {...above(side, 300)} testid="shape-menu">
        {SHAPES.map((s) => (
          <button
            key={s.id}
            type="button"
            className="mi shape-mi"
            role="menuitemradio"
            aria-checked={s.id === shape.id}
            onClick={() => {
              setShape(s)
              setOpen(false)
              pill.current?.focus({ preventScroll: true })
              announce(fitWords(s))
            }}
            data-testid={`shape-${s.id}`}
          >
            {s.id === shape.id ? <Icon name="check" size={16} /> : <span className="mi-sp" />}
            <span className="shape-mi-text">
              <span>
                {s.label}
                <span className="r">{s.ratio}</span>
              </span>
              <span className="shape-mi-fit">{fitWords(s)}</span>
            </span>
          </button>
        ))}
      </PopMenu>
    </span>
  )
}
