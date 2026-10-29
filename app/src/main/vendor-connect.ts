// "Use Claude Code" / "Use the Codex app": the person's own AI app, already installed. One click starts its own sign-in
// in the browser when it is signed out, checks it worked and makes it the AI editor. A missing app is not installed
// here: the row links to its maker's install page. The page only ever learns
// {vendor, state, step, version, plan kind, message, problem}: never a path or an account. The one exception is
// ChatGPT's sign-in with a code, offered when its browser sign-in cannot open its port: the person has to read and
// type that code on OpenAI's page, so the page gets it and OpenAI's link (signIn: 'code', deviceCode).
import type { VendorInfo, VendorProblem, VendorStep } from '../shared/api'
import type { DeviceCode, LoginResult, Vendor } from './vendor-setup'

export interface CliStatus {
  state: 'missing' | 'broken' | 'signed_out' | 'ready'
  bin?: string
  version?: string
  plan?: string
  reason?: string
  chatgptMoved?: boolean
  /** with 'signed_out': the app could not tell (slow, or an answer it cannot read). Codex clears its credentials when a
   * sign-in starts, so Connect never starts one on this alone: only the person's Sign in does (signIn). */
  unknown?: boolean
}

export interface VendorDeps {
  status(v: Vendor): Promise<CliStatus>
  /** with onDeviceCode: Codex's sign-in with a code (vendor-setup.ts runLogin) */
  login(v: Vendor, bin: string, signal: AbortSignal, onDeviceCode?: (c: DeviceCode) => void): Promise<LoginResult>
  /** makes it the AI editor (ai.setActive). It may first check the app answers, so it can fail with plain words
   * (`userMessage`) and stops on `signal`. */
  select(v: Vendor, signal: AbortSignal): Promise<void>
  emit(info: VendorInfo): void
  log?(line: string): void
  /** how long a sign-in may wait in the browser (default 10 minutes) */
  loginTimeoutMs?: number
}

export const LOGIN_TIMEOUT_MS = 10 * 60_000


export const VENDOR_MESSAGES: Record<Exclude<VendorProblem, 'cancelled'>, (v: Vendor) => string> = {
  sign_in_failed: () => "The sign-in didn’t finish. Try again.",
  sign_in_timeout: () => "We stopped waiting for the sign-in. Try again when you’re ready.",
  // in use (another program, often a sign-in left open) or reserved (Windows' excluded port ranges): the same way out
  port_busy: () =>
    process.platform === 'win32' ? "Another program or Windows is holding the port ChatGPT’s sign-in uses." : "Another program is holding the port ChatGPT’s sign-in uses.",
  free_plan: () => "You’re signed in, but your Claude plan doesn’t include the Claude Code app. It needs Claude Pro or Max.",
  // OpenAI: "Enable device code login in your ChatGPT security settings (personal account) or ChatGPT workspace
  // permissions (workspace admin)." (learn.chatgpt.com/docs/auth, 2026-10-28; it names no menu path)
  device_code_off: () => "Sign-in with a code is turned off. Turn on device code login in ChatGPT’s security settings, or ask your workspace admin.",
  status_unknown: () => "Couldn’t tell whether ChatGPT is signed in."
}

/** Choosing Claude sends it one short message first (ai index.ts setActive): why that failed, in plain words. */
export function claudeCheckWords(e: unknown, platform: NodeJS.Platform): string {
  const x = (e ?? {}) as { code?: unknown; userMessage?: unknown }
  switch (x.code) {
    case 'cli_limited':
      // the AI package's words name the window and when it resets ("…hit its weekly limit. It resets tomorrow at 9:00 AM")
      return typeof x.userMessage === 'string' && x.userMessage ? x.userMessage : 'Your Claude Code account has hit its limit.'
    case 'cli_timeout':
      return "Claude took too long to answer. Check you’re online, then try again."
    case 'cli_error':
      return "Claude didn’t answer. Open your Claude Code app once to check it works, then try again."
    case 'cli_missing':
      return `The Claude Code app isn’t on ${platform === 'darwin' ? 'this Mac' : 'this PC'} any more.`
    default:
      return typeof x.userMessage === 'string' && x.userMessage ? x.userMessage : VENDOR_MESSAGES.sign_in_failed('claude')
  }
}

export const MOVED_NOTE = "ChatGPT now connects through OpenAI’s Codex app. Click Connect ChatGPT once."

interface Run {
  ctrl: AbortController
  login?: AbortController
  restart?: boolean
  /** ChatGPT's sign-in with a code instead of the browser's */
  code?: boolean
  /** the person chose Sign in on an unknown status: sign in even though the app could not tell */
  signIn?: boolean
  done: Promise<VendorInfo>
}

export function createVendorConnect(deps: VendorDeps) {
  const runs = new Map<Vendor, Run>()
  const last = new Map<Vendor, VendorInfo>()

  const info = (v: Vendor, st: CliStatus, step: VendorStep, extra: Partial<VendorInfo> = {}): VendorInfo => ({
    vendor: v,
    state: st.state,
    step,
    ...(st.version ? { version: st.version } : {}),
    ...(st.plan ? { plan: st.plan } : {}),
    ...(v === 'chatgpt' && st.chatgptMoved && st.state !== 'ready' && step === 'idle' ? { message: MOVED_NOTE } : {}),
    ...(st.state === 'signed_out' && st.unknown && step === 'idle' ? { problem: 'status_unknown' as const, message: VENDOR_MESSAGES.status_unknown(v) } : {}),
    ...extra
  })
  const emit = (i: VendorInfo): VendorInfo => {
    last.set(i.vendor, i)
    deps.emit(i)
    return i
  }
  const fail = (v: Vendor, st: CliStatus, problem: VendorProblem, message: string): VendorInfo => emit(info(v, st, 'failed', { problem, message }))

  async function flow(v: Vendor, run: Run): Promise<VendorInfo> {
    const signal = run.ctrl.signal
    let st = await deps.status(v)
    // not installed, or will not start: the row says so and links to the maker's install page; nothing runs
    if (st.state === 'missing' || st.state === 'broken') return emit(info(v, st, 'idle'))
    // Unclear whether it is signed in: a sign-in would clear what Codex has, so stop and ask (Check again / Sign in).
    if (st.state === 'signed_out' && st.unknown && !run.signIn) return fail(v, st, 'status_unknown', VENDOR_MESSAGES.status_unknown(v))
    while (st.state === 'signed_out') {
      if (signal.aborted) return emit(info(v, st, 'idle', { problem: 'cancelled' }))
      if (!st.bin) return emit(info(v, st, 'idle'))
      const withCode = run.code ? { signIn: 'code' as const } : {}
      emit(info(v, st, 'signing_in', withCode))
      run.restart = false
      const login = (run.login = new AbortController())
      const timeout = setTimeout(() => login.abort(), deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS)
      const onCancel = (): void => login.abort()
      signal.addEventListener('abort', onCancel, { once: true })
      let r: LoginResult
      try {
        const signedOut = st
        r = await deps.login(v, st.bin, login.signal, run.code ? (c) => void emit(info(v, signedOut, 'signing_in', { ...withCode, deviceCode: c })) : undefined)
      } finally {
        clearTimeout(timeout)
        signal.removeEventListener('abort', onCancel)
        run.login = undefined
      }
      if (signal.aborted) return emit(info(v, st, 'idle', { problem: 'cancelled' }))
      if (run.restart) continue // "Open the sign-in page again": a fresh sign-in, which opens a fresh page
      if (r.aborted) return fail(v, st, 'sign_in_timeout', VENDOR_MESSAGES.sign_in_timeout(v))
      if (r.portBusy) return emit(info(v, st, 'failed', { problem: 'port_busy', message: VENDOR_MESSAGES.port_busy(v), ...(r.portReserved ? { portReserved: true } : {}) }))
      if (r.deviceCodeOff) return fail(v, st, 'device_code_off', VENDOR_MESSAGES.device_code_off(v))
      emit(info(v, st, 'checking'))
      st = await deps.status(v)
      if (st.state !== 'ready') return fail(v, st, 'sign_in_failed', VENDOR_MESSAGES.sign_in_failed(v))
    }
    if (signal.aborted) return emit(info(v, st, 'idle', { problem: 'cancelled' }))
    if (st.state !== 'ready') return fail(v, st, 'sign_in_failed', VENDOR_MESSAGES.sign_in_failed(v))
    // Anthropic's own page already stops a free account (it never comes back); this catches a plan it lets through.
    if (v === 'claude' && st.plan?.toLowerCase() === 'free') return fail(v, st, 'free_plan', VENDOR_MESSAGES.free_plan(v))
    try {
      await deps.select(v, signal)
    } catch (e) {
      if (signal.aborted) return emit(info(v, st, 'idle', { problem: 'cancelled' }))
      const said = (e as { userMessage?: unknown } | null)?.userMessage
      return fail(v, st, 'sign_in_failed', typeof said === 'string' && said ? said : VENDOR_MESSAGES.sign_in_failed(v))
    }
    return emit(info(v, st, 'done'))
  }

  /** Signs in if needed, then selects. One at a time per vendor; starting one vendor stops the other. */
  function connect(v: Vendor, opts: { code?: boolean; signIn?: boolean } = {}): Promise<VendorInfo> {
    const current = runs.get(v)
    if (current) return current.done
    const other: Vendor = v === 'claude' ? 'chatgpt' : 'claude'
    runs.get(other)?.ctrl.abort()
    const run = { ctrl: new AbortController(), code: opts.code === true, signIn: opts.signIn === true } as Run
    run.done = flow(v, run)
      .catch((e) => {
        deps.log?.(`[vendor] ${v} connect: ${String((e as Error)?.message ?? e)}`)
        return emit({ vendor: v, state: 'missing', step: 'failed', problem: 'sign_in_failed', message: VENDOR_MESSAGES.sign_in_failed(v) })
      })
      .finally(() => {
        if (runs.get(v) === run) runs.delete(v)
      })
    runs.set(v, run)
    return run.done
  }

  return {
    /** A fresh look, plus the step of a connect in progress. */
    async status(v: Vendor): Promise<VendorInfo> {
      const running = runs.get(v)
      if (running) return last.get(v)!
      const st = await deps.status(v)
      return info(v, st, 'idle')
    },
    connect: (v: Vendor): Promise<VendorInfo> => connect(v),
    /** The person's explicit Sign in on a status the app could not read: connect, starting the sign-in anyway. */
    signIn: (v: Vendor): Promise<VendorInfo> => connect(v, { signIn: true }),
    /** Stops a waiting sign-in or the check. */
    cancel(v: Vendor): void {
      runs.get(v)?.ctrl.abort()
    },
    /** ChatGPT only, and only on the person's click: the same connect, signing in with a code (after the port case). */
    signInWithCode(v: Vendor): Promise<VendorInfo> {
      if (v !== 'chatgpt') return Promise.reject({ code: 'BAD_INPUT', userMessage: 'Only ChatGPT signs in with a code.' })
      return connect(v, { code: true })
    },
    /** Restarts a waiting browser sign-in, so the CLI opens a fresh page. A code sign-in is not restarted: it would
     * replace the code on screen with a new one. */
    signInAgain(v: Vendor): boolean {
      const run = runs.get(v)
      if (!run?.login || run.code) return false
      run.restart = true
      run.login.abort()
      return true
    },
    running(v: Vendor): boolean {
      return runs.has(v)
    }
  }
}

export type VendorConnect = ReturnType<typeof createVendorConnect>
