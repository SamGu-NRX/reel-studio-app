// Installs the person's own AI app (Anthropic's Claude Code app, OpenAI's Codex app) and starts its OWN sign-in.
// Reel Studio never sees the sign-in: the vendor's CLI opens the vendor's page in the browser and catches the answer
// itself (on 127.0.0.1); the app only learns "the process ended" and then asks the CLI "signed in or not?".
//
// Install = the vendor's own install script, downloaded to a FILE and run hidden. Never a `irm … | iex` or
// `curl … | bash` command line: Microsoft Defender flags that one-liner as Trojan:Win32/Commando.A!ml and blocks it
// (measured 2026-10-25). The same script run as a file was not flagged.
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'

export type Vendor = 'claude' | 'chatgpt'

/** Where each vendor publishes its installer (the commands on their own install pages, fetched by us instead). */
export const INSTALL_SCRIPTS: Record<Vendor, { mac: string; win: string }> = {
  claude: { mac: 'https://claude.ai/install.sh', win: 'https://claude.ai/install.ps1' },
  chatgpt: { mac: 'https://chatgpt.com/codex/install.sh', win: 'https://chatgpt.com/codex/install.ps1' }
}


const VENDOR_NAME: Record<Vendor, string> = { claude: 'Anthropic', chatgpt: 'OpenAI' }
const APP_NAME: Record<Vendor, string> = { claude: "Anthropic’s Claude Code app", chatgpt: "OpenAI’s Codex app" }

export const INSTALL_TIMEOUT_MS = 10 * 60_000

export class VendorError extends Error {
  constructor(
    readonly code: 'install_failed' | 'unsupported',
    readonly userMessage: string,
    /** for main.log only (install output holds no secret); never sent to the page */
    readonly detail?: string
  ) {
    super(userMessage)
  }
}

export type SpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess

export interface Plan {
  url: string
  fileName: string
  cmd: string
  args: string[]
}

/** The command that runs a downloaded installer FILE. */
export function installPlan(vendor: Vendor, platform: NodeJS.Platform, dir: string, systemRoot = 'C:\\Windows'): Plan {
  if (platform === 'win32') {
    const file = win32.join(dir, `${vendor}-install.ps1`)
    return {
      url: INSTALL_SCRIPTS[vendor].win,
      fileName: file,
      cmd: win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file]
    }
  }
  if (platform === 'darwin') {
    const file = posix.join(dir, `${vendor}-install.sh`)
    // Anthropic's script is bash; OpenAI's is POSIX sh (as their own pages run them)
    return { url: INSTALL_SCRIPTS[vendor].mac, fileName: file, cmd: vendor === 'claude' ? '/bin/bash' : '/bin/sh', args: [file] }
  }
  throw new VendorError('unsupported', 'Reel Studio can install it for you on a Mac or a Windows PC only.')
}

/** Refuses any command line that pipes a download into a shell. A guard, so a later edit cannot bring it back. */
export function assertRunsAFile(plan: Pick<Plan, 'cmd' | 'args'>): void {
  const line = [plan.cmd, ...plan.args].join(' ')
  if (/\|\s*(iex|invoke-expression|bash|sh|zsh)\b|\b(irm|iwr|invoke-webrequest|invoke-restmethod|curl|wget)\b|https?:\/\//i.test(line)) {
    throw new Error(`refusing to run a download-and-pipe command line: ${line}`)
  }
}

/** The environment for a vendor installer or CLI: no ANTHROPIC_* / OPENAI_* (a stray API key must never pick the
 * account), every case-variant of the same name collapsed, plus `extra`. */
export function vendorEnv(base: NodeJS.ProcessEnv, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(base)) if (!/^(ANTHROPIC_|OPENAI_)/i.test(k)) out[k] = v
  for (const [k, v] of Object.entries(extra)) {
    for (const old of Object.keys(out)) if (old.toLowerCase() === k.toLowerCase()) delete out[old]
    if (v !== undefined) out[k] = v
  }
  return out
}

/** Ends a process and everything it started (PowerShell's downloads, a login's helper). Only OUR pid, never by name. */
export function killTree(child: ChildProcess, platform: NodeJS.Platform, spawn: SpawnFn = nodeSpawn, systemRoot = 'C:\\Windows'): void {
  if (child.pid === undefined || child.exitCode !== null) return
  try {
    if (platform === 'win32') {
      spawn(win32.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } else {
      process.kill(-child.pid, 'SIGTERM') // the child leads its own process group (detached)
    }
  } catch {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
}

export interface InstallDeps {
  vendor: Vendor
  platform: NodeJS.Platform
  /** <userData>/vendor-setup */
  dir: string
  env: NodeJS.ProcessEnv
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
  spawn?: SpawnFn
  signal?: AbortSignal
  timeoutMs?: number
  systemRoot?: string
  log?: (line: string) => void
}

/** Downloads the vendor's installer to a file and runs it hidden. Resolves when it exits 0. */
export async function runInstall(d: InstallDeps): Promise<void> {
  const planned = installPlan(d.vendor, d.platform, d.dir, d.systemRoot)
  // The file is written and run where this computer puts it: the plan joins for the target system, and on a Mac a
  // win32 plan (tests) would turn the folder into one file name written under the current folder. On Windows and
  // on a Mac the two are the same path.
  const fileName = join(d.dir, win32.basename(planned.fileName))
  const plan = { ...planned, fileName, args: planned.args.map((a) => (a === planned.fileName ? fileName : a)) }
  assertRunsAFile(plan)
  const cantReach = `${APP_NAME[d.vendor]} didn’t install: this computer couldn’t reach ${VENDOR_NAME[d.vendor]}. Check your internet, then try again.`
  let bytes: Buffer
  try {
    const res = await d.fetch(plan.url, { signal: d.signal })
    if (!res.ok) throw new VendorError('install_failed', cantReach, `GET ${plan.url} -> ${res.status}`)
    bytes = Buffer.from(await res.arrayBuffer())
  } catch (e) {
    if (d.signal?.aborted) throw e
    if (e instanceof VendorError) throw e
    throw new VendorError('install_failed', cantReach, String((e as Error)?.message ?? e))
  }
  // A captive portal or an error page is not an installer.
  const head = bytes.subarray(0, 200).toString('utf8').trimStart()
  if (bytes.length < 200 || head.startsWith('<')) throw new VendorError('install_failed', cantReach, `GET ${plan.url}: not a script (${bytes.length} bytes)`)
  await mkdir(d.dir, { recursive: true })
  await writeFile(plan.fileName, bytes) // the exact bytes (no re-encoding: PowerShell reads them as published)
  if (d.platform !== 'win32') await chmod(plan.fileName, 0o755)
  d.log?.(`[vendor] installing ${d.vendor}: ${plan.cmd} ${plan.args.join(' ')}`)

  const spawn = d.spawn ?? nodeSpawn
  const env = vendorEnv(d.env, d.vendor === 'chatgpt' ? { CODEX_NON_INTERACTIVE: '1' } : {})
  await new Promise<void>((resolve, reject) => {
    let tail = ''
    let timedOut = false
    const child = spawn(plan.cmd, plan.args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: d.platform !== 'win32' })
    const keep = (b: Buffer | string): void => {
      tail = (tail + String(b)).slice(-4000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    const stop = (): void => killTree(child, d.platform, spawn, d.systemRoot)
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, d.timeoutMs ?? INSTALL_TIMEOUT_MS)
    d.signal?.addEventListener('abort', stop, { once: true })
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new VendorError('install_failed', `${APP_NAME[d.vendor]} didn’t install. Try again, or install it yourself.`, String(e?.message ?? e)))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      d.signal?.removeEventListener('abort', stop)
      d.log?.(`[vendor] ${d.vendor} installer exited ${code}${timedOut ? ' (timed out)' : ''}: ${tail.replace(/\s+/g, ' ').slice(-600)}`)
      if (d.signal?.aborted) return reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }))
      if (code === 0) return resolve()
      reject(
        new VendorError(
          'install_failed',
          timedOut
            ? `${APP_NAME[d.vendor]} took too long to install. Try again, or install it yourself.`
            : `${APP_NAME[d.vendor]} didn’t install. Your antivirus or your company’s settings may have stopped it. Try again, or install it yourself.`,
          tail
        )
      )
    })
  })
}

export const LOGIN_ARGS: Record<Vendor, string[]> = {
  // --claudeai: the Claude subscription sign-in, never the Console (API billing) one
  claude: ['auth', 'login', '--claudeai'],
  chatgpt: ['login']
}

/** Codex's sign-in with a code, for when its browser sign-in cannot open its callback port. */
export const DEVICE_LOGIN_ARGS = ['login', '--device-auth']

export interface DeviceCode {
  /** OpenAI's page where the code is entered (https, an openai.com host) */
  url: string
  /** the one-time code, as Codex prints it (e.g. Q42W-7R5TB) */
  code: string
}

export interface LoginResult {
  code: number | null
  /** the CLI could not open its callback port (Codex: 127.0.0.1:1455): another program has it, or Windows reserved it */
  portBusy?: boolean
  /** with portBusy: Windows reserved the port (os error 10013), so the browser sign-in fails every time until it is
   * freed (a reboot, or a WinNAT restart); "in use" alone may clear when the other program lets go */
  portReserved?: boolean
  /** Codex's code sign-in is not enabled for this server */
  deviceCodeOff?: boolean
  aborted?: boolean
}

/**
 * Codex's callback port could not be opened. In use: "Port 127.0.0.1:1457 is already in use" (Codex tries 1455, then
 * its fallback 1457), or the OS's own words (10048 on Windows, 48 on macOS). Reserved: Windows keeps excluded port
 * ranges (Hyper-V / WinNAT, `netsh int ipv4 show excludedportrange`), and binding inside one fails with WSAEACCES,
 * which Codex 0.163 prints as "An attempt was made to access a socket in a way forbidden by its access permissions.
 * (os error 10013)". That sentence is Windows' own and is translated on other Windows languages; the number is not.
 */
const PORT_HELD = /address already in use|address in use|is already in use|only one usage of each socket|os error (10048|48|10013)\b|forbidden by its access permissions/i

export function loginPortBlocked(output: string): boolean {
  return PORT_HELD.test(output)
}

const PORT_RESERVED = /os error 10013\b|forbidden by its access permissions/i

/** The reserved case of loginPortBlocked: WSAEACCES, which no retry fixes. */
export function loginPortReserved(output: string): boolean {
  return PORT_RESERVED.test(output)
}

/** Codex 0.163 and later, when its device-code endpoint answers 404 (see codex-rs/login/src/device_code_auth.rs). */
const DEVICE_CODE_OFF = /device code login is not enabled/i

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
const CODE_SHAPE = /^[A-Z0-9]{3,}(?:-[A-Z0-9]{3,})+$/

/**
 * The page and the one-time code from what `codex login --device-auth` prints ("1. Open this link …", "2. Enter this
 * one-time code …", each value on the next line, in ANSI colours). Null until both are there. Only an https page on
 * openai.com or one of its subdomains is accepted: it is handed to the page as a link the person opens.
 */
export function parseDeviceCode(output: string): DeviceCode | null {
  const text = output.replace(ANSI, '')
  const lines = text.split(/\r?\n/).map((l) => l.trim())
  const after = (re: RegExp): string | undefined => {
    const i = lines.findIndex((l) => re.test(l))
    return i < 0 ? undefined : lines.slice(i + 1).find((l) => l.length > 0)
  }
  const link = after(/open this link/i)
  const code = after(/one-time code/i)
  if (!link || !code || !CODE_SHAPE.test(code)) return null
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || !(url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com'))) return null
  return { url: url.href, code }
}

/**
 * Runs the CLI's own sign-in, hidden. It opens the vendor's page in the browser and waits for the answer on 127.0.0.1.
 * Its output (links carrying the sign-in's state) stays in this function: it is never sent to the page or the log.
 * stdin is closed, so a sign-in code can never be pasted through Reel Studio.
 *
 * With `onDeviceCode` (Codex only) it runs `codex login --device-auth` instead, the same way: Codex prints a page and
 * a one-time code, the person types the code on that page, and Codex learns the answer by asking OpenAI. The page and
 * the code are the only output that leaves this function, through `onDeviceCode`, once; nothing is logged.
 */
export function runLogin(d: {
  vendor: Vendor
  bin: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  signal?: AbortSignal
  spawn?: SpawnFn
  systemRoot?: string
  onDeviceCode?: (c: DeviceCode) => void
}): Promise<LoginResult> {
  if (d.onDeviceCode && d.vendor !== 'chatgpt') throw new Error(`${d.vendor} has no sign-in with a code`)
  const spawn = d.spawn ?? nodeSpawn
  const args = d.onDeviceCode ? DEVICE_LOGIN_ARGS : LOGIN_ARGS[d.vendor]
  return new Promise((resolve) => {
    let out = ''
    let printed = '' // stdout from the start, for the code (it comes first, in a few hundred bytes)
    let handedOver = false
    const child = spawn(d.bin, args, { env: vendorEnv(d.env), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: d.platform !== 'win32' })
    const keep = (b: Buffer | string): void => {
      out = (out + String(b)).slice(-8000)
    }
    child.stdout?.on('data', (b: Buffer | string) => {
      keep(b)
      if (!d.onDeviceCode || handedOver || printed.length > 16_000) return
      printed += String(b)
      const found = parseDeviceCode(printed)
      if (found) {
        handedOver = true
        d.onDeviceCode(found)
      }
    })
    child.stderr?.on('data', keep)
    const stop = (): void => killTree(child, d.platform, spawn, d.systemRoot)
    if (d.signal?.aborted) stop()
    d.signal?.addEventListener('abort', stop, { once: true })
    child.on('error', () => resolve({ code: -1 }))
    child.on('close', (code) => {
      d.signal?.removeEventListener('abort', stop)
      if (d.signal?.aborted) return resolve({ code, aborted: true })
      if (code === 0) return resolve({ code })
      if (d.onDeviceCode && DEVICE_CODE_OFF.test(out)) return resolve({ code, deviceCodeOff: true })
      if (!d.onDeviceCode && loginPortBlocked(out)) return resolve({ code, portBusy: true, ...(loginPortReserved(out) ? { portReserved: true } : {}) })
      resolve({ code })
    })
  })
}

/** Test switch REELSTUDIO_TEST_VENDOR_HOME: the vendor CLIs see a throwaway home (a fresh machine: nothing installed,
 * nobody signed in) and a bare system PATH, so a real install + sign-in can be tried without touching the developer's
 * own Claude Code and Codex apps. REELSTUDIO_TEST_BROWSER passes BROWSER through (Claude honours it). */
export function testVendorEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv | null {
  const home = base.REELSTUDIO_TEST_VENDOR_HOME
  if (!home) return null
  const sr = base.SystemRoot || base.SYSTEMROOT || 'C:\\Windows'
  const path = platform === 'win32' ? [win32.join(sr, 'System32'), sr, win32.join(sr, 'System32', 'WindowsPowerShell', 'v1.0')].join(';') : '/usr/bin:/bin:/usr/sbin:/sbin'
  const P = platform === 'win32' ? win32 : posix
  return vendorEnv(base, {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: P.join(home, 'AppData', 'Local'),
    APPDATA: P.join(home, 'AppData', 'Roaming'),
    CLAUDE_CONFIG_DIR: P.join(home, '.claude'),
    CODEX_HOME: P.join(home, '.codex'),
    ZDOTDIR: home,
    PATH: path,
    ...(base.REELSTUDIO_TEST_BROWSER ? { BROWSER: base.REELSTUDIO_TEST_BROWSER } : {})
  })
}

/** Test switch, sign-in step only: the CLI's sign-in keeps the person's REAL home (so the browser it opens is their
 * own, signed-in profile: with the throwaway USERPROFILE/LOCALAPPDATA, Chrome started an empty profile) and only its
 * config folder is the throwaway one, so the sign-in still lands there and not in their own Claude Code / Codex. */
export function testVendorLoginEnv(base: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv | null {
  const home = base.REELSTUDIO_TEST_VENDOR_HOME
  if (!home) return null
  const P = platform === 'win32' ? win32 : posix
  return vendorEnv(base, {
    CLAUDE_CONFIG_DIR: P.join(home, '.claude'),
    CODEX_HOME: P.join(home, '.codex'),
    ...(base.REELSTUDIO_TEST_BROWSER ? { BROWSER: base.REELSTUDIO_TEST_BROWSER } : {})
  })
}
