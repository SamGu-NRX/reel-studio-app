// The first run's sample editing itself: the transcript fills in while the phone fast-forwards, a pencil strikes
// the filler, the false start and the pauses, the words close up in three snips (each with its sound, the new
// length and the phone jumping on the same frame), subtitles come in, and a cover is picked. Runs on DOM refs, so
// playback and the per-frame marker never re-render React.
import { EDITS, RAW_LEN, SIMPLE_CUTS, SNIPS, subGroups, toEdit, toRaw, type EditName, type SubGroup, type Token } from './sample'
import { sound } from './sound'
import { byKeyboard } from '../motion'

const EASE_OUT = 'cubic-bezier(.23,1,.32,1)'
const EASE_IN_OUT = 'cubic-bezier(.77,0,.175,1)'
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
// A cancelled animation (Skip, leaving the screen) rejects .finished: an expected stop, not an error.
const done = (a: Animation) =>
  a.finished.then(
    () => true,
    () => false
  )

export interface DemoEls {
  phone: HTMLElement
  scr: HTMLElement
  videos: Record<'raw' | EditName, HTMLVideoElement>
  subs: HTMLElement
  ptag: HTMLElement
  scrim: HTMLElement
  cands: HTMLElement
  cover: HTMLElement
  words: HTMLElement
  lenNow: HTMLElement
  lenWas: HTMLElement
  note: HTMLElement
  chips: HTMLElement[]
}

export class Demo {
  private run = 0
  private view: 'raw' | EditName = 'raw'
  private subsOn = false
  private holding = false
  private paused = false
  private frame = 0
  private curGroup: SubGroup | null = null
  private curWord: number | null = null
  private groups: Record<EditName, SubGroup[]>
  finished = false

  constructor(
    private els: DemoEls,
    private toks: Token[],
    private on: { beat: (i: number, state: 'on' | 'done') => void; finished: () => void; paused: (p: boolean) => void }
  ) {
    this.groups = { simple: subGroups(EDITS.simple, toks), ai: subGroups(EDITS.ai, toks) }
    this.frame = requestAnimationFrame(this.sync)
  }

  destroy(): void {
    this.run++
    cancelAnimationFrame(this.frame)
    Object.values(this.els.videos).forEach((v) => v.pause())
  }

  private ok = (R: number) => R === this.run

  private show(name: 'raw' | EditName, { at = 0 as number | null, play = true } = {}) {
    for (const [k, v] of Object.entries(this.els.videos)) {
      const on = k === name
      v.classList.toggle('off', !on)
      if (!on) v.pause()
    }
    const v = this.els.videos[name]
    if (at != null) v.currentTime = at
    if (play && !this.paused) void v.play().catch(() => this.setPaused(true))
  }

  setPaused(p: boolean): void {
    this.paused = p
    const v = this.els.videos[this.holding ? 'raw' : this.view]
    if (p) v.pause()
    else {
      this.els.cover.classList.remove('show')
      void v.play().catch(() => {})
    }
    this.on.paused(p)
  }

  private tag(text: string | null, orig = false) {
    const t = this.els.ptag
    t.classList.toggle('show', !!text)
    t.classList.toggle('orig', orig)
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
    s.animate(
      reduced()
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, scale: '.92' },
            { opacity: 1, scale: '1' }
          ],
      { duration: reduced() ? 120 : 180, easing: EASE_OUT }
    )
  }

  private mark(i: number | null) {
    if (i === this.curWord) return
    if (this.curWord !== null) this.els.chips[this.curWord]?.classList.remove('now')
    this.curWord = i
    if (i !== null) this.els.chips[i]?.classList.add('now')
  }

  /** One loop keeps the subtitles on the phone and the marker in the transcript on the same word. */
  private sync = () => {
    this.frame = requestAnimationFrame(this.sync)
    if (!this.subsOn) return
    if (this.holding) {
      const t = this.els.videos.raw.currentTime
      this.setSubs(null)
      this.mark(this.find((w) => !!w.text && t >= w.s && t < w.e))
      return
    }
    if (this.view === 'raw') return
    const edit = EDITS[this.view]
    const t = this.els.videos[this.view].currentTime
    this.setSubs(this.groups[this.view].find((g) => t >= g.s && t < g.e) ?? null)
    const raw = toRaw(edit, t)
    this.mark(this.find((w) => !!w.text && edit.kept.has(w.seg) && raw >= w.s && raw < w.e))
  }

  private find(f: (t: Token) => boolean): number | null {
    const i = this.toks.findIndex(f)
    return i < 0 ? null : i
  }

  private chipsOf(segs: string[]) {
    return this.els.chips.filter((_, i) => segs.includes(this.toks[i].seg))
  }

  /** The words reflow at once, then each slides from where it was: they close ranks instead of jumping. */
  private flip(mutate: () => void, dur = 380) {
    if (dur === 0) return mutate()
    const shown = this.els.chips.filter((e) => !e.classList.contains('gone')).concat(Array.from(this.els.words.querySelectorAll<HTMLElement>('.pic')))
    const first = new Map(shown.map((e) => [e, e.getBoundingClientRect()]))
    mutate()
    if (reduced()) return
    for (const [e, f] of first) {
      if (e.classList.contains('gone')) continue
      const l = e.getBoundingClientRect()
      const dx = f.left - l.left
      const dy = f.top - l.top
      if (Math.abs(dx) + Math.abs(dy) < 0.5) continue
      e.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: dur, easing: EASE_IN_OUT })
    }
  }

  private strike(segs: string[]): number {
    const els = this.chipsOf(segs)
    els.forEach((e, i) =>
      window.setTimeout(
        () => {
          e.classList.add('cut')
          requestAnimationFrame(() => e.classList.add('drawn'))
        },
        reduced() ? 0 : i * 35
      )
    )
    return reduced() ? 300 : els.length * 35 + 320
  }

  private async collapse(segs: string[]) {
    const els = this.chipsOf(segs)
    if (reduced()) {
      els.forEach((e) => e.classList.add('gone'))
      return
    }
    const ran = await Promise.all(
      els.map((e) => done(e.animate([{ opacity: 1 }, { opacity: 0, scale: '.9' }], { duration: 150, easing: EASE_OUT, fill: 'forwards' })))
    )
    if (!ran.every(Boolean)) return
    this.flip(() => els.forEach((e) => e.classList.add('gone')))
    els.forEach((e) => e.getAnimations().forEach((a) => a.cancel()))
  }

  private setLen(now: string, was: string | null) {
    const n = this.els.lenNow
    if (n.textContent !== now) {
      n.textContent = now
      n.animate(
        reduced()
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, translate: '0 -6px' },
              { opacity: 1, translate: '0 0' }
            ],
        { duration: 200, easing: EASE_OUT }
      )
    }
    this.els.lenWas.textContent = was ?? ''
  }

  note(text: string): void {
    this.els.note.textContent = text
    this.els.note.classList.toggle('show', !!text)
  }

  /** Listening runs faster than playback, as it does in the app: 24 s of talk in about 3.4 s. The phone keeps pace. */
  private async listen(R: number) {
    const SPAN = 3400
    const t0 = performance.now()
    const raw = this.els.videos.raw
    if (!reduced()) raw.playbackRate = RAW_LEN / (SPAN / 1000)
    let i = 0
    while (i < this.toks.length) {
      if (!this.ok(R)) return
      const heard = ((performance.now() - t0) / SPAN) * RAW_LEN
      while (i < this.toks.length && this.toks[i].s <= heard) {
        const e = this.els.chips[i]
        e.classList.add('in')
        if (!reduced())
          e.animate(
            [
              { opacity: 0, translate: '0 4px' },
              { opacity: 1, translate: '0 0' }
            ],
            { duration: 220, easing: EASE_OUT }
          )
        if (this.toks[i].text) this.mark(i)
        i++
      }
      await new Promise(requestAnimationFrame)
    }
    raw.playbackRate = 1
    this.mark(null)
  }

  async start(): Promise<void> {
    const R = ++this.run
    this.show('raw', { at: 0 })
    this.tag('Raw video · 0:24')
    this.on.beat(0, 'on')
    await this.listen(R)
    if (!this.ok(R)) return
    this.on.beat(0, 'done')
    this.els.words.style.minHeight = `${this.els.words.offsetHeight}px`
    await wait(300)
    if (!this.ok(R)) return

    this.on.beat(1, 'on')
    await wait(this.strike(SIMPLE_CUTS))
    if (!this.ok(R)) return
    await wait(250)
    for (const [n, snip] of SNIPS.entries()) {
      if (!this.ok(R)) return
      const c = this.collapse(snip.segs)
      window.setTimeout(
        () => {
          if (!this.ok(R)) return
          sound.play('cut', 1 + n * 0.06)
          this.show('raw', { at: snip.jump })
          this.tag(`Cutting · ${snip.len}`)
          if (!reduced()) this.els.scrim.animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: 180, easing: EASE_OUT })
        },
        reduced() ? 120 : 150
      )
      await c
      if (!this.ok(R)) return
      this.setLen(snip.len, '0:24')
      await wait(420)
    }
    if (!this.ok(R)) return
    this.on.beat(1, 'done')

    this.on.beat(2, 'on')
    this.view = 'simple'
    this.subsOn = true
    this.tag(null)
    this.show('simple', { at: 0 })
    await wait(3000)
    if (!this.ok(R)) return
    this.on.beat(2, 'done')

    this.on.beat(3, 'on')
    await this.pickCover(R)
    if (!this.ok(R)) return
    this.on.beat(3, 'done')
    this.finish()
  }

  private async pickCover(R: number) {
    const { cands, cover, scr, scrim, videos } = this.els
    videos.simple.pause()
    this.subsOn = false
    this.setSubs(null)
    this.mark(null)
    scrim.classList.add('show')
    this.tag('Picking a cover')
    cands.classList.add('show')
    if (!reduced())
      cands
        .querySelectorAll('img')
        .forEach((im, i) => im.animate([{ translate: '0 14px' }, { translate: '0 0' }], { duration: 300, delay: i * 60, easing: EASE_OUT, fill: 'backwards' }))
    await wait(850)
    if (!this.ok(R)) return
    cands.classList.add('picked')
    await wait(600)
    if (!this.ok(R)) return
    const pick = cands.querySelector('[data-pick]')!.getBoundingClientRect()
    const s = scr.getBoundingClientRect()
    this.tag(null)
    cover.classList.add('show')
    if (reduced()) await done(cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT }))
    else {
      const k = pick.width / s.width
      const dx = pick.left + pick.width / 2 - (s.left + s.width / 2)
      const dy = pick.top + pick.height / 2 - (s.top + s.height / 2)
      const insetY = (s.height - pick.height / k) / 2
      cover.querySelector('.cover-t')?.animate(
        [
          { opacity: 0, translate: '0 8px' },
          { opacity: 1, translate: '0 0' }
        ],
        { duration: 320, delay: 300, easing: EASE_OUT, fill: 'backwards' }
      )
      await done(
        cover.animate(
          [
            { transform: `translate(${dx}px,${dy}px) scale(${k})`, clipPath: `inset(${insetY}px 0px round ${10 / k}px)` },
            { transform: 'none', clipPath: 'inset(0px 0px round 0px)' }
          ],
          { duration: 480, easing: EASE_IN_OUT }
        )
      )
    }
    if (!this.ok(R)) return
    cands.classList.remove('show', 'picked')
    scrim.classList.remove('show')
    sound.play('ready')
    await wait(1400)
    if (!this.ok(R)) return
    this.subsOn = true
    // reduced motion: the cover stays, and Play starts the reel
    if (reduced()) return this.setPaused(true)
    await done(cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: EASE_OUT }))
    if (!this.ok(R)) return
    cover.classList.remove('show')
    this.show('simple', { at: 0 })
  }

  private finish() {
    this.finished = true
    this.on.finished()
  }

  /** Skip: land on the finished state with no motion. */
  skip(): void {
    this.run++
    this.els.videos.raw.playbackRate = 1
    this.els.chips.forEach((e, i) => {
      e.classList.add('in')
      e.getAnimations().forEach((a) => a.cancel())
      if (!EDITS.simple.kept.has(this.toks[i].seg)) e.classList.add('cut', 'drawn', 'gone')
    })
    this.mark(null)
    this.setLen('0:12', '0:24')
    for (let i = 0; i < 4; i++) this.on.beat(i, 'done')
    this.els.cands.classList.remove('show', 'picked')
    this.els.scrim.classList.remove('show')
    this.els.cover.classList.remove('show')
    this.tag(null)
    this.view = 'simple'
    this.subsOn = true
    this.show('simple', { at: 0 })
    this.finish()
  }

  /** Press and hold: the original plays, and the cut words and pauses come back into the transcript. */
  holdStart(): void {
    if (!this.finished || this.holding) return
    this.holding = true
    this.els.phone.classList.add('held')
    const v = this.view as EditName
    const at = toRaw(EDITS[v], this.els.videos[v].currentTime)
    this.els.cover.classList.remove('show')
    this.show('raw', { at, play: !this.paused })
    this.tag('Original · 0:24', true)
    this.setSubs(null)
    this.flip(
      () => {
        this.els.chips.forEach((e, i) => !EDITS[v].kept.has(this.toks[i].seg) && e.classList.remove('gone'))
        this.els.words.querySelectorAll('.pic').forEach((p) => p.classList.add('gone'))
      },
      byKeyboard() ? 0 : 260
    )
    this.setLen('0:24', null)
  }
  /** The one release path: a pointer up, a lost key up, a window blur and leaving the screen all come here. */
  holdEnd(): void {
    if (!this.holding) return
    this.holding = false
    this.els.phone.classList.remove('held')
    const v = this.view as EditName
    this.els.videos.raw.pause()
    const t = this.els.videos.raw.currentTime
    this.show(v, { at: toEdit(EDITS[v], t), play: !this.paused })
    this.tag(null)
    this.flip(
      () => {
        this.els.chips.forEach((e, i) => !EDITS[v].kept.has(this.toks[i].seg) && e.classList.add('gone'))
        this.els.words.querySelectorAll('.pic').forEach((p) => p.classList.remove('gone'))
      },
      byKeyboard() ? 0 : 260
    )
    this.setLen(EDITS[v].len, '0:24')
  }

  /**
   * What an AI editor adds, on the same sample: the weaker of two takes goes and two pictures come in. The result
   * is bundled, so the panel says what an AI editor adds rather than crediting the one just connected.
   */
  async upgrade(pictures: [string, string, string][], added: (text: string) => void): Promise<void> {
    if (this.view === 'ai') return
    const R = this.run
    await wait(400)
    if (!this.ok(R)) return
    this.note('Two takes of this line. Keeping the better one.')
    await wait(this.strike(['r4']) + 350)
    if (!this.ok(R)) return
    const c = this.collapse(['r4'])
    window.setTimeout(() => this.ok(R) && sound.play('cut'), reduced() ? 120 : 150)
    await c
    this.setLen('0:09', '0:24')
    added('Kept the better of two takes')
    await wait(500)
    if (!this.ok(R)) return
    const made: HTMLElement[] = []
    this.flip(() => {
      for (const [after, src, label] of pictures) {
        const i = this.toks.findIndex((t) => t.text === after)
        const span = document.createElement('span')
        span.className = 'tk pic in'
        span.setAttribute('role', 'img')
        span.setAttribute('aria-label', label)
        const img = document.createElement('img')
        img.src = src
        img.alt = ''
        span.append(img)
        this.els.chips[i].after(' ', span)
        made.push(span)
      }
    })
    if (!reduced())
      made.forEach((p, i) =>
        p.animate(
          [
            { opacity: 0, scale: '.8' },
            { opacity: 1, scale: '1' }
          ],
          { duration: 300, delay: 120 + i * 80, easing: EASE_OUT, fill: 'backwards' }
        )
      )
    added('Added two pictures')
    this.note('')
    this.view = 'ai'
    this.subsOn = true
    if (!this.holding) this.show('ai', { at: 0 })
  }
}
