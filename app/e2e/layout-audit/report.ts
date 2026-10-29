// Turns the detectors' findings into findings.json, FINDINGS.md and outlined screenshots.
import type { Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { Box, RawFinding, Severity } from './detect'

export interface Finding extends RawFinding {
  screen: string
  state: string
  size: string
  source: string | null
  shot: string | null
}

export interface ScreenResult {
  screen: string
  commit: string
  at: string
  sizes: string[]
  states: string[]
  /** States that could not be reached, with why. */
  unreached: { state: string; why: string }[]
  allowed: number
  findings: Finding[]
}

const REPO = resolve(__dirname, '..', '..', '..')
const RENDERER = join(REPO, 'app', 'src', 'renderer', 'src')

/** Where the report goes: REELSTUDIO_AUDIT_OUT, else app/test-results/layout-audit (ignored by git). */
export const OUT = resolve(process.env.REELSTUDIO_AUDIT_OUT ?? join(REPO, 'app', 'test-results', 'layout-audit'))

export function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// ---- likely source file ------------------------------------------------------------------------------
let sources: { file: string; text: string }[] | null = null
function loadSources(): { file: string; text: string }[] {
  if (sources) return sources
  const out: { file: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(tsx|css)$/.test(e.name)) out.push({ file: relative(REPO, p), text: readFileSync(p, 'utf8') })
    }
  }
  walk(RENDERER)
  return (sources = out)
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The renderer file that most likely draws the element: the nearest test id or class name (element first, then its
 * ancestors) that only a few .tsx files mention. Generic classes (btn, row) match too many files and are skipped.
 */
export function sourceFor(hints: string[]): string | null {
  const files = loadSources()
  for (const h of hints) {
    const [kind, name] = [h.slice(0, h.indexOf(':')), h.slice(h.indexOf(':') + 1)]
    if (!name || name.length < 3) continue
    const re =
      kind === 'testid'
        ? new RegExp(`(testid|data-testid)=\\{?["'\`]${escape(name)}["'\`]|["'\`]${escape(name)}["'\`]`)
        : new RegExp(`className=[^>]*["'\` ]${escape(name)}["'\` $]`)
    const tsx = files.filter((f) => f.file.endsWith('.tsx') && re.test(f.text))
    if (tsx.length >= 1 && tsx.length <= 2) return tsx.map((f) => f.file).join(', ')
    if (kind === 'class' && tsx.length === 0) {
      const cssRe = new RegExp(`\\.${escape(name)}(?![\\w-])`)
      const css = files.filter((f) => f.file.endsWith('.css') && cssRe.test(f.text))
      if (css.length === 1) return css[0].file
    }
  }
  return null
}

// ---- screenshots -------------------------------------------------------------------------------------
const COLORS: Record<Severity, string> = { P1: '#e5251b', P2: '#f08c00', P3: '#7048e8' }

/** Outlines every finding's boxes over the page, takes one screenshot, and removes the outlines again. */
export async function outlinedShot(page: Page, findings: RawFinding[], file: string): Promise<void> {
  mkdirSync(join(file, '..'), { recursive: true })
  const marks = findings.flatMap((f, i) => f.boxes.map((b: Box, j) => ({ ...b, color: COLORS[f.severity], label: j === 0 ? `${i + 1} ${f.detector}` : '' })))
  await page.evaluate((all) => {
    const area = innerWidth * innerHeight
    const layer = document.createElement('div')
    layer.id = '__layout_audit_overlay'
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none'
    for (const m of all) {
      const d = document.createElement('div')
      // a big box (the area doing the clipping, a column) gets an outline only, so the screen under it stays readable
      const fill = m.w * m.h > area * 0.15 ? 'transparent' : `${m.color}1f`
      d.style.cssText = `position:fixed;left:${m.x}px;top:${m.y}px;width:${Math.max(m.w, 2)}px;height:${Math.max(m.h, 2)}px;outline:2px ${fill === 'transparent' ? 'dashed' : 'solid'} ${m.color};outline-offset:-1px;background:${fill}`
      if (m.label) {
        const t = document.createElement('span')
        t.textContent = m.label
        t.style.cssText = `position:absolute;left:-2px;top:-16px;font:600 10px/14px system-ui;color:#fff;background:${m.color};padding:0 4px;border-radius:3px;white-space:nowrap`
        d.appendChild(t)
      }
      layer.appendChild(d)
    }
    document.body.appendChild(layer)
  }, marks)
  try {
    await page.screenshot({ path: file })
  } finally {
    await page.evaluate(() => document.getElementById('__layout_audit_overlay')?.remove())
  }
}

// ---- report files ------------------------------------------------------------------------------------
export function writeScreen(result: ScreenResult): void {
  mkdirSync(join(OUT, 'screens'), { recursive: true })
  writeFileSync(join(OUT, 'screens', `${result.screen}.json`), JSON.stringify(result, null, 2) + '\n')
  writeReport()
}

const ORDER: Severity[] = ['P1', 'P2', 'P3']
const SIZES_ORDER = ['1100x720', '1280x820', '1512x982', '1920x1080']

/** Rebuilds findings.json and FINDINGS.md from every screen's latest result in OUT/screens. */
export function writeReport(): void {
  const dir = join(OUT, 'screens')
  if (!existsSync(dir)) return
  const screens: ScreenResult[] = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .sort((a, b) => a.screen.localeCompare(b.screen))
  const all = screens.flatMap((s) => s.findings)
  writeFileSync(join(OUT, 'findings.json'), JSON.stringify({ screens: screens.map(({ findings, ...rest }) => ({ ...rest, counts: counts(findings) })), findings: all }, null, 2) + '\n')

  // one line per repeated finding: same detector, element and partner, across states and sizes
  type Group = { f: Finding; states: Set<string>; sizes: Set<string>; screens: Set<string>; shots: Set<string> }
  const groups = new Map<string, Group>()
  for (const f of all) {
    const key = [f.severity, f.detector, f.selector, f.other ?? '', f.detail.replace(/-?\d+(\.\d+)?/g, '#')].join('|')
    const g = groups.get(key) ?? { f, states: new Set(), sizes: new Set(), screens: new Set(), shots: new Set() }
    g.states.add(f.state)
    g.sizes.add(f.size)
    g.screens.add(f.screen)
    if (f.shot) g.shots.add(f.shot)
    groups.set(key, g)
  }
  const sizes = (s: Set<string>): string => (s.size === SIZES_ORDER.length ? 'all sizes' : SIZES_ORDER.filter((x) => s.has(x)).join(', '))
  const lines: string[] = ['# Layout audit', '']
  lines.push('Generated by `app/e2e/layout-audit.spec.ts`. Each line is one problem, grouped across the states and sizes it shows up in. P1 and P2 fail the gate; P3 is reported only.', '')
  lines.push('| Screen | Commit | Run at | P1 | P2 | P3 | Allowed | Not reached |', '|---|---|---|---|---|---|---|---|')
  for (const s of screens) {
    const c = counts(s.findings)
    lines.push(`| ${s.screen} | ${s.commit} | ${s.at.slice(0, 16).replace('T', ' ')} | ${c.P1} | ${c.P2} | ${c.P3} | ${s.allowed} | ${s.unreached.map((u) => u.state).join(', ') || '-'} |`)
  }
  for (const sev of ORDER) {
    const list = [...groups.values()].filter((g) => g.f.severity === sev).sort((a, b) => a.f.screen.localeCompare(b.f.screen) || a.f.detector.localeCompare(b.f.detector))
    lines.push('', `## ${sev} (${list.length})`, '')
    if (!list.length) lines.push('None.')
    for (const g of list) {
      const f = g.f
      const what = f.text ? `"${f.text.slice(0, 50)}"` : ''
      const shot = [...g.shots][0]
      lines.push(
        `- **${[...g.screens].join(', ')}** \`${[...g.states].join('`, `')}\` at ${sizes(g.sizes)}: ${f.detector}, ${f.detail}. ${what} \`${f.selector}\`${f.other ? ` with \`${f.other}\`` : ''}. Source: ${f.source ? `\`${f.source}\`` : 'not found'}.${shot ? ` [shot](${shot})` : ''}`
      )
    }
  }
  const unreached = screens.flatMap((s) => s.unreached.map((u) => `- ${s.screen} \`${u.state}\`: ${u.why}`))
  if (unreached.length) lines.push('', '## Not reached', '', ...unreached)
  writeFileSync(join(OUT, 'FINDINGS.md'), lines.join('\n') + '\n')
}

export function counts(findings: RawFinding[]): Record<Severity, number> {
  return { P1: findings.filter((f) => f.severity === 'P1').length, P2: findings.filter((f) => f.severity === 'P2').length, P3: findings.filter((f) => f.severity === 'P3').length }
}
