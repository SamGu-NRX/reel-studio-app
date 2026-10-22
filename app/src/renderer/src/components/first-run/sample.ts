// The first run's bundled sample (assets/sample, credits in THIRD_PARTY.md): one raw take, what the simple edit and
// the AI edit keep of it, and the words with their times. The clips were rendered from these same ranges.

export type SegKind = 'filler' | 'pause' | 'restart' | 'keep' | 'take'
export interface Seg {
  id: string
  kind: SegKind
  text?: string
  /** seconds in raw.mp4 */
  s: number
  e: number
}

export const TRANSCRIPT: Seg[] = [
  { id: 'r0', kind: 'filler', text: 'So, um…', s: 0.3, e: 1.2 },
  { id: 'p1', kind: 'pause', s: 1.2, e: 2.5 },
  { id: 'r1', kind: 'restart', text: 'You don’t need a mixer.', s: 2.5, e: 3.9 },
  { id: 'p2', kind: 'pause', s: 3.9, e: 4.4 },
  { id: 'r2', kind: 'restart', text: 'Sorry, let me start again.', s: 4.4, e: 5.8 },
  { id: 'p3', kind: 'pause', s: 5.8, e: 6.9 },
  { id: 'r3', kind: 'keep', text: 'You don’t need a mixer to make good bread.', s: 6.9, e: 9.6 },
  { id: 'p4', kind: 'pause', s: 9.6, e: 10.6 },
  { id: 'r4', kind: 'take', text: 'All you need is your hands, flour, water and salt.', s: 10.6, e: 13.6 },
  { id: 'p5', kind: 'pause', s: 13.6, e: 14.6 },
  { id: 'r5', kind: 'keep', text: 'All you need is your hands, flour, water, salt and a little time.', s: 14.6, e: 18.6 },
  { id: 'p6', kind: 'pause', s: 18.6, e: 19.4 },
  { id: 'r6', kind: 'keep', text: 'Here’s how.', s: 19.4, e: 20.4 },
  { id: 'p7', kind: 'pause', s: 20.4, e: 24.0 }
]
export const RAW_LEN = 24

export type EditName = 'simple' | 'ai'
interface EditDef {
  len: string
  /** [segment, start, end] in raw.mp4, in the order the edit plays them */
  segs: [string, number, number][]
}
const DEFS: Record<EditName, EditDef> = {
  simple: {
    len: '0:12',
    segs: [
      ['r3', 6.8, 9.7],
      ['r4', 10.5, 13.7],
      ['r5', 14.5, 18.7],
      ['r6', 19.3, 20.7]
    ]
  },
  ai: {
    len: '0:09',
    segs: [
      ['r3', 6.8, 9.7],
      ['r5', 14.5, 18.7],
      ['r6', 19.3, 20.7]
    ]
  }
}

export interface Edit {
  len: string
  dur: number
  kept: Set<string>
  map: { id: string; a: number; b: number; ed: number }[]
}
export const EDITS: Record<EditName, Edit> = Object.fromEntries(
  (Object.entries(DEFS) as [EditName, EditDef][]).map(([name, d]) => {
    let t = 0
    const map = d.segs.map(([id, a, b]) => {
      const m = { id, a, b, ed: t }
      t += b - a
      return m
    })
    return [name, { len: d.len, dur: t, kept: new Set(d.segs.map((s) => s[0])), map }]
  })
) as Record<EditName, Edit>

/** Time in the edit for a time in the raw take, or null when that moment was cut. */
export function toEdit(edit: Edit, raw: number): number | null {
  const m = edit.map.find((x) => raw >= x.a && raw <= x.b)
  return m ? m.ed + raw - m.a : null
}
/** Time in the raw take for a time in the edit. */
export function toRaw(edit: Edit, ed: number): number {
  const m = edit.map.find((x) => ed >= x.ed && ed <= x.ed + (x.b - x.a)) ?? edit.map[0]
  return m.a + ed - m.ed
}

export interface Token {
  seg: string
  s: number
  e: number
  /** a word, or null for a pause */
  text: string | null
  /** the pause's length, for its chip */
  pause?: string
}

/** Every chip in the transcript in order: words timed by their share of letters in their line, and pauses. */
export function tokens(): Token[] {
  const out: Token[] = []
  for (const seg of TRANSCRIPT) {
    if (seg.kind === 'pause') {
      out.push({ seg: seg.id, s: seg.s, e: seg.e, text: null, pause: `${(seg.e - seg.s).toFixed(1)} s` })
      continue
    }
    const ws = seg.text!.split(' ')
    const chars = ws.reduce((n, w) => n + w.length + 1, 0)
    let t = seg.s
    for (const w of ws) {
      const d = ((seg.e - seg.s) * (w.length + 1)) / chars
      out.push({ seg: seg.id, s: t, e: t + d, text: w })
      t += d
    }
  }
  return out
}

/** Subtitle groups for an edit: up to three words, a new group after punctuation, the key word marked. */
const KEY = /^(mixer|bread|hands|flour|water|salt|time|how)$/i
const clean = (w: string) => w.replace(/[.,…]+$/, '')
export interface SubGroup {
  s: number
  e: number
  words: { w: string; key: boolean }[]
}
export function subGroups(edit: Edit, toks: Token[]): SubGroup[] {
  const kept = toks.filter((t) => t.text && edit.kept.has(t.seg))
  const gs: Token[][] = []
  let cur: Token[] = []
  kept.forEach((w, i) => {
    cur.push(w)
    if (/[.,…]$/.test(w.text!) || cur.length === 3 || i === kept.length - 1) {
      gs.push(cur)
      cur = []
    }
  })
  return gs.map((g, i) => ({
    s: toEdit(edit, g[0].s) ?? 0,
    e: i < gs.length - 1 ? (toEdit(edit, gs[i + 1][0].s) ?? edit.dur) : edit.dur,
    words: g.map((w) => ({ w: clean(w.text!), key: KEY.test(clean(w.text!)) }))
  }))
}

/** What the simple edit cuts: the false start, the filler and every pause. */
export const SIMPLE_CUTS = ['r0', 'p1', 'r1', 'p2', 'r2', 'p3', 'p4', 'p5', 'p6', 'p7']
/** The three snips the demo makes, each with the length after it and where the phone jumps to in the raw take. */
export const SNIPS: { segs: string[]; len: string; jump: number }[] = [
  { segs: ['r0', 'p1'], len: '0:21', jump: 2.5 },
  { segs: ['r1', 'p2', 'r2', 'p3'], len: '0:17', jump: 6.8 },
  { segs: ['p4', 'p5', 'p6', 'p7'], len: '0:12', jump: 10.5 }
]
