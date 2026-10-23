// The sample's two sounds (Kenney, CC0), each on something you see happen: a soft drop on every cut (the words
// close up, the length drops, the picture jumps) and one chime when the cover lands. Nothing else in the app plays
// a sound. Whether they play is an app setting (main/settings.ts soundEffects), behind the labelled toggle.
import { reel } from '../../api'
import cutUrl from '../../assets/sample/cut.mp3'
import readyUrl from '../../assets/sample/ready.mp3'

const VOLUME = { cut: 0.3, ready: 0.38 }
const SRC = { cut: cutUrl, ready: readyUrl }
type Name = keyof typeof VOLUME

const els: Partial<Record<Name, HTMLAudioElement>> = {}
let on = true
let chosen = false
// Read once at start-up, long before the sample plays. A choice made before it answers wins.
void reel.app.info().then((i) => {
  if (!chosen) on = i.soundEffects
})

export const sound = {
  get on(): boolean {
    return on
  },
  /** The promise rejects when the setting could not be saved; the choice still holds for this session. */
  set(next: boolean): Promise<unknown> {
    chosen = true
    on = next
    if (!next) for (const a of Object.values(els)) a?.pause()
    return reel.app.setSoundEffects(next)
  },
  play(name: Name, rate = 1): void {
    if (!on) return
    const a = (els[name] ??= Object.assign(new Audio(SRC[name]), { volume: VOLUME[name], preload: 'auto' }))
    a.preservesPitch = false
    a.playbackRate = rate
    a.currentTime = 0
    // a refused play() only means it stayed silent; the picture already carries the moment
    void a.play().catch(() => {})
  }
}
