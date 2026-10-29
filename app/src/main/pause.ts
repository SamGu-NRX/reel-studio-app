// "Paused without you" (ux-foundation-b.md sections 3.4 and 7). Version 1 stopped by a plan at its limit, no
// internet, the computer going to sleep or a quit is not a failure: it pauses and continues by itself when the
// condition clears or the app opens again. A note stopped by a plan limit or a quit waits the same way.
import type { PausedFor } from '../shared/api'

/** Plan or rate limits, by provider (ai providers/cli.ts, openai.ts, anthropic.ts, and connection.ts for a server such
 * as CLIProxyAPI that names its limit). */
const LIMIT_CODES = new Set(['cli_limited', 'chatgpt_usage_limit', 'claude_rate_limited', 'connection_limited'])

/**
 * Whether a job's failure pauses it, and why. `online`: the computer has a network now (Electron net.isOnline);
 * `slept`: it went to sleep while the job ran. A note pauses only for a limit (B section 7: a note that fails offline
 * says so, and waits for Try again).
 */
export function pauseFor(
  err: unknown,
  ctx: { kind: 'first-edit' | 'note'; online: boolean; slept: boolean; editor: string | null }
): PausedFor | null {
  const e = (err ?? {}) as { code?: unknown; resetsAt?: unknown }
  const base = { until: null, editor: ctx.editor }
  if (typeof e.code === 'string' && LIMIT_CODES.has(e.code)) {
    const until = typeof e.resetsAt === 'string' && !Number.isNaN(Date.parse(e.resetsAt)) ? e.resetsAt : null
    return { ...base, reason: 'limit', until }
  }
  if (ctx.kind === 'note') return null
  if (!ctx.online) return { ...base, reason: 'offline' }
  if (ctx.slept) return { ...base, reason: 'sleep' }
  return null
}

/** A plan with no reset time is tried again this often. */
export const LIMIT_RETRY_MS = 15 * 60_000
/** How often "Waiting for internet" looks again. */
export const ONLINE_POLL_MS = 5_000

/**
 * Continues paused reels on their own: a plan limit at its reset time (`marginMs` after it), no internet once the
 * network is back, sleep on wake, a quit at once (the app has just opened). `resume` starts the work again; it
 * clears the pause itself (any job start does, store.ts AppState.paused).
 */
export function createPauser(deps: { online: () => boolean; resume: (slug: string) => Promise<void>; log: (s: string) => void; marginMs?: number }) {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const offline = new Set<string>()
  const asleep = new Set<string>()
  /** Between the computer's sleep and its wake: a sleep pause scheduled after the wake waits only for the network. */
  let sleeping = false
  let poll: ReturnType<typeof setInterval> | null = null

  function cancel(slug: string): void {
    const t = timers.get(slug)
    if (t) clearTimeout(t)
    timers.delete(slug)
    offline.delete(slug)
    asleep.delete(slug)
    if (!offline.size && poll) {
      clearInterval(poll)
      poll = null
    }
  }

  function go(slug: string): void {
    cancel(slug)
    deps.resume(slug).catch((e) => deps.log(`[pause] ${slug} could not continue: ${String((e as { userMessage?: string })?.userMessage ?? e)}`))
  }

  function waitOnline(slug: string): void {
    offline.add(slug)
    poll ??= setInterval(() => {
      if (!deps.online()) return
      for (const s of [...offline]) go(s)
    }, ONLINE_POLL_MS)
  }

  return {
    /** `now`: for tests. */
    schedule(slug: string, p: PausedFor, now = Date.now()): void {
      cancel(slug)
      deps.log(`[pause] ${slug}: ${p.reason}${p.until ? ` until ${p.until}` : ''}`)
      if (p.reason === 'quit') return go(slug)
      if (p.reason === 'offline') return waitOnline(slug)
      if (p.reason === 'sleep') return sleeping ? void asleep.add(slug) : waitOnline(slug)
      const at = p.until ? Date.parse(p.until) + (deps.marginMs ?? 30_000) : now + LIMIT_RETRY_MS
      timers.set(slug, setTimeout(() => go(slug), Math.max(0, at - now)))
    },
    /** The computer is going to sleep (Electron powerMonitor 'suspend'). */
    slept(): void {
      sleeping = true
    },
    /** The computer woke (Electron powerMonitor 'resume'): what sleep paused goes on, or waits for the network. */
    woke(): void {
      sleeping = false
      for (const slug of [...asleep]) {
        asleep.delete(slug)
        if (deps.online()) go(slug)
        else waitOnline(slug)
      }
    },
    /** The person resumed it, stopped it or deleted the reel: nothing continues on its own. */
    cancel,
    /** Reels with a pause scheduled, for tests and the quit question. */
    pending: (): string[] => [...new Set([...timers.keys(), ...offline, ...asleep])]
  }
}

export type Pauser = ReturnType<typeof createPauser>

/** The quit question (B section 7), or null when nothing is being made. */
export function quitQuestion(making: number): { message: string; yes: string } | null {
  if (!making) return null
  return { message: `${making === 1 ? '1 reel is' : `${making} reels are`} still being made. Quit and continue ${making === 1 ? 'it' : 'them'} next time?`, yes: 'Quit and continue next time' }
}
