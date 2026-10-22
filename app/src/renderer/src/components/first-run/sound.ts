// Three quiet sounds for the first run (Kenney, CC0): a soft drop when a cut lands, one chime when the cover lands,
// a click when sound is turned back on. None plays before the first click, and none while the system is asking a
// question (a privacy prompt is no place for a sound): `hush` wraps every request that can raise one.
import cutUrl from '../../assets/sample/cut.mp3'
import readyUrl from '../../assets/sample/ready.mp3'
import toggleUrl from '../../assets/sample/toggle.mp3'

const KEY = 'rs.first-run-sound'
const VOLUME = { cut: 0.3, ready: 0.38, toggle: 0.28 }
type Name = keyof typeof VOLUME

const els: Partial<Record<Name, HTMLAudioElement>> = {}
let unlocked = false
let quiet = 0

export const sound = {
  get on(): boolean {
    return localStorage.getItem(KEY) !== 'off'
  },
  set(on: boolean): void {
    localStorage.setItem(KEY, on ? 'on' : 'off')
    if (on) sound.play('toggle')
  },
  /** after the first click: browsers and people both expect silence until then */
  unlock(): void {
    unlocked = true
  },
  play(name: Name, rate = 1): void {
    if (!sound.on || !unlocked || quiet > 0) return
    const src = { cut: cutUrl, ready: readyUrl, toggle: toggleUrl }[name]
    const a = (els[name] ??= Object.assign(new Audio(src), { volume: VOLUME[name], preload: 'auto' }))
    a.preservesPitch = false
    a.playbackRate = rate
    a.currentTime = 0
    // a refused play() only means it stayed silent; the picture already carries the moment
    void a.play().catch(() => {})
  },
  /** Silent from the click that asks until the answer is in. Anything still playing stops. */
  async hush<T>(ask: () => Promise<T>): Promise<T> {
    quiet++
    for (const a of Object.values(els)) a?.pause()
    try {
      return await ask()
    } finally {
      quiet--
    }
  }
}
