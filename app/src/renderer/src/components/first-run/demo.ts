// The first run's sample editing itself on the Reel screen's own player: the words fill in while the take
// fast-forwards, a pencil strikes the filler, the false start and the pauses, three snips land (each with its
// sound, the new length and the picture jumping on the same frame), subtitles come in, and a cover is picked.
//
// It drives DOM refs, so playback never re-renders React, and it moves things with transform and opacity only. It
// never reads layout while anything moves: a snip lets the paragraph reflow once instead of sliding every word to
// its new place (measuring each word after a change forced a 17.5 ms layout in the last build, finding 4).
//
// One <video> plays the sample. Changing what it shows swaps its source; the frame on screen is copied to a canvas
// first and covers the swap, so nothing goes black and no second video is ever playing.
import type { Step, StepId } from '../../../../shared/steps'
import { EDITS, RAW_LEN, SIMPLE_CUTS, SNIPS, subGroups, toEdit, toRaw, type EditName, type SubGroup, type Token } from './sample'
import { sound } from './sound'

const EASE = 'cubic-bezier(.2,.8,.2,1)'
const EASE_IN_OUT = 'cubic-bezier(.77,0,.175,1)'
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
// A cancelled animation (Skip, leaving the screen) rejects .finished: an expected stop, not an error.
const done = (a: Animation) =>
  a.finished.then(
    () => true,
    () => false
  )
/** True once the video presents a frame; false if none comes within 1.5 s (the still then stays over it). */
const frameShown = (v: HTMLVideoElement) =>
  new Promise<boolean>((r) => {
    const late = window.setTimeout(() => r(false), 1500)
    v.requestVideoFrameCallback(() => {
      window.clearTimeout(late)
      r(true)
    })
  })

/** The rows the sample shows, Version 1's own (shared/steps.ts), one for each thing the welcome promised. */
export const SAMPLE_STEPS: StepId[] = ['listen', 'retakes', 'edit', 'subtitles', 'cover']
export const freshSteps = (): Step[] => SAMPLE_STEPS.map((id) => ({ id, state: 'todo' }))

export type View = 'raw' | EditName

export interface DemoEls {
  video: HTMLVideoElement
  /** the last frame, over the video while its source changes */
  still: HTMLCanvasElement
  subs: HTMLElement
  tag: HTMLElement
  scrim: HTMLElement
  cands: HTMLElement
  cover: HTMLElement
  /** every token's chip, in transcript order */
  chips: HTMLElement[]
  /** each transcript segment's span, by segment id */
  segs: Map<string, HTMLElement>
  /** the two picture chips the editor's version adds, hidden until then */
  pics: HTMLElement[]
}

export interface DemoEvents {
  steps(s: Step[]): void
  /** what plays now: the raw take, or a version */
  view(v: View): void
  /** the person is holding the video for the original */
  held(on: boolean): void
  finished(): void
  paused(p: boolean): void
  /** Version 2 (the editor's) is being made, then is on screen */
  upgrade(state: 'making' | 'done'): void
}

export class Demo {
  private run = 0
  private swap = 0
  private src: View | null = null
  private view: View = 'raw'
  private subsOn = false
  private holding = false
  private paused = false
  private frame = 0
  private curGroup: SubGroup | null = null
  private curWord: number | null = null
  private groups: Record<EditName, SubGroup[]>
  private steps = freshSteps()
  private upgraded = false
  private upgrading = false
  finished = false

  constructor(
    private els: DemoEls,
    private toks: Token[],
    private urls: Record<View, string>,
    private on: DemoEvents
  ) {
    this.groups = { simple: subGroups(EDITS.simple, toks), ai: subGroups(EDITS.ai, toks) }
    this.frame = requestAnimationFrame(this.sync)
    // the raw take loads under the welcome, so Get started finds the player ready
    this.src = 'raw'
    els.video.src = urls.raw
  }

  destroy(): void {
    this.run++
    this.swap++
    cancelAnimationFrame(this.frame)
    this.els.video.pause()
  }

  private ok = (R: number) => R === this.run

  private step(id: StepId, state: Step['state'], result?: string) {
    this.steps = this.steps.map((s) => (s.id === id ? { id, state, ...(result ? { result } : {}) } : s))
    this.on.steps(this.steps)
  }

  /** Puts `name` on the one player at `at` seconds. A new source loads under a still of the frame it replaces. */
  private async show(name: View, { at = 0 as number | null, play = true } = {}) {
    const { video: v, still } = this.els
    const n = ++this.swap
    if (this.src !== name) {
      if (this.src !== null && v.readyState >= 2) {
        still.width = v.videoWidth
        still.height = v.videoHeight
        still.getContext('2d')?.drawImage(v, 0, 0)
        still.classList.add('on')
      }
      this.src = name
      v.src = this.urls[name]
      // a version loops while it is watched; the raw take plays once, for listening or while held
      v.loop = name !== 'raw'
    }
    if (at != null) v.currentTime = at
    this.on.view(name)
    // a play() a later swap interrupted rejects too: only this swap's own refusal pauses the sample
    if (play && !this.paused) void v.play().catch(() => n === this.swap && this.setPaused(true))
    else v.pause()
    if ((await frameShown(v)) && n === this.swap) still.classList.remove('on')
  }

  setPaused(p: boolean): void {
    this.paused = p
    const v = this.els.video
    if (p) v.pause()
    else {
      this.els.cover.classList.remove('show')
      void v.play().catch(() => {})
    }
    this.on.paused(p)
  }

  private tag(text: string | null) {
    const t = this.els.tag
    t.classList.toggle('show', !!text)
    if (text) t.textContent = text
  }

  private setSubs(g: SubGroup | null) {
    if (g === this.curGroup) return
    this.curGroup = g
    const s = this.els.subs
    s.replaceChildren()
    if (!g) return
    const line = document.createElement('span')
    g.words.forEach((w, i) => {
      if (i) line.append(' ')
      if (w.key) {
        const em = document.createElement('em')
        em.textContent = w.w
        line.append(em)
      } else line.append(w.w)
    })
    s.append(line)
    if (!reduced())
      line.animate(
        [
          { opacity: 0, transform: 'scale(.94)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 160, easing: EASE }
      )
  }

  private mark(i: number | null) {
    if (i === this.curWord) return
    if (this.curWord !== null) this.els.chips[this.curWord]?.classList.remove('now')
    this.curWord = i
    if (i !== null) this.els.chips[i]?.classList.add('now')
  }

  /** One loop keeps the subtitles on the picture and the marker in the transcript on the same word. */
  private sync = () => {
    this.frame = requestAnimationFrame(this.sync)
    if (!this.subsOn) return
    const t = this.els.video.currentTime
    if (this.holding || this.view === 'raw') {
      this.setSubs(null)
      this.mark(this.holding ? this.find((w) => !!w.text && t >= w.s && t < w.e) : null)
      return
    }
    const edit = EDITS[this.view]
    this.setSubs(this.groups[this.view].find((g) => t >= g.s && t < g.e) ?? null)
    const raw = toRaw(edit, t)
    this.mark(this.find((w) => !!w.text && edit.kept.has(w.seg) && raw >= w.s && raw < w.e))
  }

  private find(f: (t: Token) => boolean): number | null {
    const i = this.toks.findIndex(f)
    return i < 0 ? null : i
  }

  /** The pencil goes through each segment in turn, every word of it at once. Returns how long the marks take. */
  private strike(segs: string[]): number {
    const gap = reduced() ? 0 : 70
    segs.forEach((id, i) =>
      window.setTimeout(() => {
        for (const c of this.els.segs.get(id)?.querySelectorAll('.tk') ?? []) c.classList.add('cut')
      }, i * gap)
    )
    return reduced() ? 200 : segs.length * gap + 300
  }

  /** The struck segments fade, then go: the words after them close up in one reflow. */
  private async snip(segs: string[]) {
    const els = segs.map((id) => this.els.segs.get(id)!)
    if (!reduced()) {
      const ran = await Promise.all(els.map((e) => done(e.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: EASE, fill: 'forwards' }))))
      if (!ran.every(Boolean)) return
    }
    for (const e of els) {
      e.classList.add('gone')
      e.getAnimations().forEach((a) => a.cancel())
    }
  }

  /** Listening runs faster than playback, as it does in the app: 24 s of talk in about 3.4 s. The picture keeps pace. */
  private async listen(R: number) {
    const SPAN = 3400
    const t0 = performance.now()
    const v = this.els.video
    if (!reduced()) v.playbackRate = RAW_LEN / (SPAN / 1000)
    let i = 0
    while (i < this.toks.length) {
      if (!this.ok(R)) return
      const heard = ((performance.now() - t0) / SPAN) * RAW_LEN
      while (i < this.toks.length && this.toks[i].s <= heard) {
        this.els.chips[i].classList.add('in')
        if (this.toks[i].text) this.mark(i)
        i++
      }
      await new Promise(requestAnimationFrame)
    }
    v.playbackRate = 1
    this.mark(null)
  }

  async start(): Promise<void> {
    const R = ++this.run
    void this.show('raw', { at: 0 })
    this.tag('Original')
    this.step('listen', 'now')
    await this.listen(R)
    if (!this.ok(R)) return
    this.step('listen', 'done', `${this.toks.filter((x) => x.text).length} words`)
    await wait(300)
    if (!this.ok(R)) return

    this.step('retakes', 'now')
    await wait(this.strike(SIMPLE_CUTS))
    if (!this.ok(R)) return
    await wait(250)
    for (const [n, cut] of SNIPS.entries()) {
      if (!this.ok(R)) return
      const s = this.snip(cut.segs)
      window.setTimeout(
        () => {
          if (!this.ok(R)) return
          sound.play('cut', 1 + n * 0.06)
          void this.show('raw', { at: cut.jump })
          this.tag(`Cutting · ${cut.len}`)
          this.step('retakes', 'now', `0:24 → ${cut.len}`)
          if (!reduced()) this.els.scrim.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 180, easing: EASE })
        },
        reduced() ? 0 : 140
      )
      await s
      if (!this.ok(R)) return
      await wait(420)
    }
    if (!this.ok(R)) return
    this.step('retakes', 'done', '0:24 → 0:12')
    // Without an editor nobody picks takes or pictures: the row says so, the way Version 1 says it.
    this.step('edit', 'skipped')

    this.step('subtitles', 'now')
    this.view = 'simple'
    this.subsOn = true
    this.tag(null)
    void this.show('simple', { at: 0 })
    await wait(3000)
    if (!this.ok(R)) return
    this.step('subtitles', 'done', 'Key words marked')

    this.step('cover', 'now')
    await this.pickCover(R)
    if (!this.ok(R)) return
    this.steps = this.doneSteps()
    this.on.steps(this.steps)
    this.finish()
  }

  private doneSteps(): Step[] {
    const result: Partial<Record<StepId, string>> = {
      listen: `${this.toks.filter((x) => x.text).length} words`,
      retakes: '0:24 → 0:12',
      subtitles: 'Key words marked',
      cover: 'Smiling at the camera'
    }
    return SAMPLE_STEPS.map((id) => (id === 'edit' ? { id, state: 'skipped' } : { id, state: 'done', result: result[id] }))
  }

  /**
   * Three frames rise; the smile is picked and grows into the cover. The candidates sit centred on the picture (CSS:
   * 26% wide each, 4% apart, the third from 67% to 93%), so the pick's centre is 30% right of the picture's: the
   * cover grows from there with transform alone.
   */
  private async pickCover(R: number) {
    const { cands, cover, scrim, video } = this.els
    video.pause()
    this.subsOn = false
    this.setSubs(null)
    this.mark(null)
    scrim.classList.add('show')
    this.tag('Picking a cover')
    cands.classList.add('show')
    if (!reduced())
      cands
        .querySelectorAll('img')
        .forEach((im, i) =>
          im.animate([{ transform: 'translateY(14px)' }, { transform: 'none' }], { duration: 300, delay: i * 60, easing: EASE, fill: 'backwards' })
        )
    await wait(850)
    if (!this.ok(R)) return
    cands.classList.add('picked')
    await wait(600)
    if (!this.ok(R)) return
    this.tag(null)
    cover.classList.add('show')
    const grow = reduced()
      ? cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE })
      : cover.animate([{ transform: 'translate(30%, 0) scale(.278)' }, { transform: 'none' }], { duration: 420, easing: EASE_IN_OUT })
    if (!reduced())
      cover.querySelector('.cover-t')?.animate(
        [
          { opacity: 0, transform: 'translateY(8px)' },
          { opacity: 1, transform: 'none' }
        ],
        { duration: 220, delay: 300, easing: EASE, fill: 'backwards' }
      )
    await done(grow)
    if (!this.ok(R)) return
    cands.classList.remove('show', 'picked')
    scrim.classList.remove('show')
    sound.play('ready')
    await wait(1400)
    if (!this.ok(R)) return
    this.subsOn = true
    // reduced motion: the cover stays, and Play starts the reel
    if (reduced()) return this.setPaused(true)
    await done(cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE }))
    if (!this.ok(R)) return
    cover.classList.remove('show')
    void this.show('simple', { at: 0 })
  }

  private finish() {
    this.finished = true
    this.on.finished()
  }

  /** Skip: the finished state at once, with no motion. */
  skip(): void {
    this.run++
    this.els.video.playbackRate = 1
    this.els.chips.forEach((e) => {
      e.classList.add('in')
      e.getAnimations().forEach((a) => a.cancel())
    })
    for (const id of SIMPLE_CUTS) {
      const seg = this.els.segs.get(id)!
      seg.getAnimations().forEach((a) => a.cancel())
      seg.classList.add('gone')
      seg.querySelectorAll('.tk').forEach((c) => c.classList.add('cut'))
    }
    this.mark(null)
    this.steps = this.doneSteps()
    this.on.steps(this.steps)
    this.els.cands.classList.remove('show', 'picked')
    this.els.scrim.classList.remove('show')
    this.els.cover.classList.remove('show')
    this.tag(null)
    this.view = 'simple'
    this.subsOn = true
    // reduced motion: nothing plays by itself once the story is told; Play starts the reel
    if (reduced()) this.setPaused(true)
    void this.show('simple', { at: 0 })
    this.finish()
  }

  /** Press and hold: the original plays where the version was, and the cut words and pauses come back. */
  holdStart(): void {
    // not while the editor's version is being made: the transcript is changing under the original
    if (!this.finished || this.holding || this.upgrading) return
    this.holding = true
    this.on.held(true)
    const v = this.view as EditName
    const at = toRaw(EDITS[v], this.els.video.currentTime)
    this.els.cover.classList.remove('show')
    void this.show('raw', { at, play: !this.paused })
    this.tag('Original · 0:24')
    this.setSubs(null)
    for (const id of SIMPLE_CUTS.concat(v === 'ai' ? ['r4'] : [])) this.els.segs.get(id)!.classList.remove('gone')
    for (const p of this.els.pics) p.classList.add('gone')
  }

  /** The one release path: a pointer up, a key up, a window blur and leaving the screen all come here. */
  holdEnd(): void {
    if (!this.holding) return
    this.holding = false
    this.on.held(false)
    const v = this.view as EditName
    void this.show(v, { at: toEdit(EDITS[v], this.els.video.currentTime), play: !this.paused })
    this.tag(null)
    for (const id of SIMPLE_CUTS.concat(v === 'ai' ? ['r4'] : [])) this.els.segs.get(id)!.classList.add('gone')
    if (v === 'ai') for (const p of this.els.pics) p.classList.remove('gone')
  }

  /**
   * What an editor adds, on the same sample: the weaker of two takes goes and two pictures come in. The result is
   * bundled, so the log says what an editor adds rather than crediting the one just connected.
   */
  async upgrade(): Promise<void> {
    if (this.upgraded) return
    this.upgraded = true
    this.holdEnd()
    this.upgrading = true
    const R = this.run
    this.on.upgrade('making')
    await wait(400)
    if (!this.ok(R)) return
    await wait(this.strike(['r4']) + 250)
    if (!this.ok(R)) return
    const s = this.snip(['r4'])
    window.setTimeout(() => this.ok(R) && sound.play('cut'), reduced() ? 0 : 140)
    await s
    await wait(400)
    if (!this.ok(R)) return
    this.els.pics.forEach((p, i) => {
      p.classList.remove('gone')
      if (!reduced())
        p.animate(
          [
            { opacity: 0, transform: 'scale(.85)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: 220, delay: i * 80, easing: EASE, fill: 'backwards' }
        )
    })
    this.view = 'ai'
    this.subsOn = true
    this.upgrading = false
    void this.show('ai', { at: 0 })
    this.on.upgrade('done')
  }
}
