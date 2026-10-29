// "Use Claude Code" / "Use the Codex app": the sign-in runner (vendor-setup.ts) and the flow around it
// (vendor-connect.ts). No real CLI or network: spawn is a fake.
import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import {
  LOGIN_ARGS,
  loginPortBlocked,
  loginPortReserved,
  parseDeviceCode,
  runLogin,
  testVendorEnv,
  testVendorLoginEnv,
  vendorEnv,
  type SpawnFn
} from '../src/main/vendor-setup'
import { MOVED_NOTE, claudeCheckWords, createVendorConnect, VENDOR_MESSAGES, type CliStatus, type VendorDeps } from '../src/main/vendor-connect'
import type { VendorInfo } from '../src/shared/api'

// ---- fakes -------------------------------------------------------------------------------------------------------

interface FakeChild extends EventEmitter {
  pid: number
  exitCode: number | null
  stdout: EventEmitter
  stderr: EventEmitter
  killed: boolean
  kill(): boolean
  finish(code: number | null, out?: string): void
}

function fakeSpawn(onSpawn?: (c: FakeChild, cmd: string, args: string[], opts: any) => void) {
  const calls: { cmd: string; args: string[]; opts: any; child: FakeChild }[] = []
  let pid = 4000
  const spawn = ((cmd: string, args: string[], opts: any) => {
    const c = new EventEmitter() as FakeChild
    c.pid = ++pid
    c.exitCode = null
    c.stdout = new EventEmitter()
    c.stderr = new EventEmitter()
    c.killed = false
    c.kill = () => ((c.killed = true), true)
    c.finish = (code, out) => {
      if (out) c.stderr.emit('data', out)
      c.exitCode = code ?? 1
      c.emit('close', code)
    }
    calls.push({ cmd, args, opts, child: c })
    onSpawn?.(c, cmd, args, opts)
    return c as unknown as ChildProcess
  }) as SpawnFn
  return { spawn, calls }
}

const ENV = { PATH: '/usr/bin', Path: 'C:\\Windows', OPENAI_API_KEY: 'k1', ANTHROPIC_API_KEY: 'k2', HOME: '/Users/p' }

describe('the vendor app\'s own sign-in', () => {
  it('claude auth login --claudeai / codex login, hidden, stdin closed (no code can be pasted through Reel Studio), no API keys', async () => {
    expect(LOGIN_ARGS).toEqual({ claude: ['auth', 'login', '--claudeai'], chatgpt: ['login'] })
    for (const vendor of ['claude', 'chatgpt'] as const) {
      const { spawn, calls } = fakeSpawn((c) => setTimeout(() => c.finish(0), 5))
      const r = await runLogin({ vendor, bin: '/x/bin', env: ENV, platform: 'darwin', spawn })
      expect(r).toEqual({ code: 0 })
      expect(calls[0].cmd).toBe('/x/bin')
      expect(calls[0].args).toEqual(LOGIN_ARGS[vendor])
      expect(calls[0].opts.stdio[0]).toBe('ignore')
      expect(calls[0].opts.windowsHide).toBe(true)
      expect(calls[0].opts.env.OPENAI_API_KEY).toBeUndefined()
      expect(calls[0].opts.env.ANTHROPIC_API_KEY).toBeUndefined()
    }
  })

  it('what the CLI prints (links with the sign-in\'s state) never leaves runLogin', async () => {
    const link = 'https://auth.example/oauth/authorize?state=SECRET_STATE'
    const { spawn } = fakeSpawn((c) => setTimeout(() => (c.stdout.emit('data', link), c.finish(0)), 5))
    const r = await runLogin({ vendor: 'chatgpt', bin: '/x/codex', env: ENV, platform: 'darwin', spawn })
    expect(JSON.stringify(r)).not.toContain('SECRET_STATE')
  })

  it('port 1455 already taken by another sign-in', async () => {
    const { spawn } = fakeSpawn((c) => setTimeout(() => c.finish(1, 'Error: Address already in use (os error 10048)'), 5))
    expect(await runLogin({ vendor: 'chatgpt', bin: '/x/codex', env: ENV, platform: 'win32', spawn })).toEqual({ code: 1, portBusy: true })
  })

  // What `codex login` prints when it cannot open its callback port, captured from Codex 0.163.0 on Windows 11.
  // Reserved: 1455 inside a Windows excluded port range (netsh int ipv4 show excludedportrange): WSAEACCES, two writes.
  const RESERVED = ['Error logging in: ', 'An attempt was made to access a socket in a way forbidden by its access permissions. (os error 10013)\n']
  const loginWith = (chunks: string[], code = 1) => {
    const { spawn } = fakeSpawn((c) => setTimeout(() => (chunks.forEach((s) => c.stderr.emit('data', s)), c.finish(code)), 5))
    return runLogin({ vendor: 'chatgpt', bin: 'C:\\x\\codex.exe', env: ENV, platform: 'win32', spawn })
  }

  it('port 1455 reserved by Windows (os error 10013, the exact output) is the port case, not a failed sign-in', async () => {
    // reserved: retrying cannot work until the port is freed, so portReserved puts the code sign-in first
    expect(await loginWith(RESERVED)).toEqual({ code: 1, portBusy: true, portReserved: true })
    // the sentence is Windows' own and is translated on other Windows languages; the error number is not
    expect(await loginWith(['Error logging in: 以一种访问权限不允许的方式做了一个访问套接字的尝试。 (os error 10013)\n'])).toEqual({ code: 1, portBusy: true, portReserved: true })
    expect(loginPortReserved(RESERVED.join(''))).toBe(true)
  })

  it('port 1455 in use: Codex tries its fallback port, then says so in its own words', async () => {
    // only in use: the other program may let go, so Try again stays first (no portReserved)
    expect(await loginWith(['Error logging in: Port 127.0.0.1:1457 is already in use\n'])).toEqual({ code: 1, portBusy: true })
    expect(loginPortReserved('Error logging in: Port 127.0.0.1:1457 is already in use')).toBe(false)
  })

  it('any other failed sign-in is not the port case', async () => {
    expect(await loginWith(['Error logging in: error sending request for url (https://auth.openai.com/oauth/token)\n'])).toEqual({ code: 1 })
    expect(loginPortBlocked('Error logging in: Permission denied (os error 13)')).toBe(false)
  })
})

describe('signing in with a code (codex login --device-auth)', () => {
  // Codex 0.163.0's own words, captured on this machine; only the one-time code is replaced (same shape, 10 characters).
  const CODE = 'Q42W-7R5TB'
  const PROMPT =
    "\nWelcome to Codex [v\x1b[90m0.163.0\x1b[0m]\n\x1b[90mOpenAI’s command-line coding agent\x1b[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n" +
    '1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n' +
    `2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94m${CODE}\x1b[0m\n\n` +
    '\x1b[90mContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\x1b[0m\n\n'

  it('finds the page and the code in what Codex prints, colours and all', () => {
    expect(parseDeviceCode(PROMPT)).toEqual({ url: 'https://auth.openai.com/codex/device', code: CODE })
  })

  it('nothing until both are there; a page that is not OpenAI\'s is never passed on', () => {
    expect(parseDeviceCode(PROMPT.slice(0, PROMPT.indexOf('2. Enter')))).toBeNull()
    expect(parseDeviceCode(PROMPT.replace('https://auth.openai.com/codex/device', 'https://auth.openai.com.evil.example/codex/device'))).toBeNull()
    expect(parseDeviceCode(PROMPT.replace('https://auth.openai.com', 'http://auth.openai.com'))).toBeNull()
    expect(parseDeviceCode('Error logging in: device code request failed with status 500')).toBeNull()
  })

  it('runs `codex login --device-auth` like the browser sign-in: hidden, stdin closed, no API keys; hands the code over once', async () => {
    const got: { url: string; code: string }[] = []
    const half = PROMPT.indexOf(CODE) + 4 // the code split across two writes
    const { spawn, calls } = fakeSpawn((c) =>
      setTimeout(() => {
        c.stdout.emit('data', PROMPT.slice(0, half))
        c.stdout.emit('data', PROMPT.slice(half))
        c.stdout.emit('data', '\n')
        c.stderr.emit('data', 'Successfully logged in\n')
        c.finish(0)
      }, 5)
    )
    const r = await runLogin({ vendor: 'chatgpt', bin: 'C:\\x\\codex.exe', env: ENV, platform: 'win32', spawn, onDeviceCode: (d) => void got.push(d) })
    expect(r).toEqual({ code: 0 })
    expect(got).toEqual([{ url: 'https://auth.openai.com/codex/device', code: CODE }])
    expect(calls[0].args).toEqual(['login', '--device-auth'])
    expect(calls[0].opts.stdio[0]).toBe('ignore')
    expect(calls[0].opts.windowsHide).toBe(true)
    expect(calls[0].opts.env.OPENAI_API_KEY).toBeUndefined()
  })

  it('"device code login is not enabled": its own answer, so the card can say where to turn it on', async () => {
    const { spawn } = fakeSpawn((c) =>
      setTimeout(() => c.finish(1, 'Error logging in with device code: device code login is not enabled for this Codex server. Use the browser login or verify the server URL.\n'), 5)
    )
    expect(await runLogin({ vendor: 'chatgpt', bin: '/x/codex', env: ENV, platform: 'darwin', spawn, onDeviceCode: () => undefined })).toEqual({ code: 1, deviceCodeOff: true })
  })

  it('only Codex signs in with a code', () => {
    expect(() => runLogin({ vendor: 'claude', bin: '/x/claude', env: ENV, platform: 'darwin', spawn: fakeSpawn().spawn, onDeviceCode: () => undefined })).toThrow()
  })

  it('aborting ends our process tree and says so', async () => {
    const ctrl = new AbortController()
    const { spawn, calls } = fakeSpawn((c, cmd) => {
      if (/taskkill/i.test(cmd)) setTimeout(() => calls[0].child.finish(null), 1)
    })
    const p = runLogin({ vendor: 'claude', bin: 'C:\\x\\claude.exe', env: ENV, platform: 'win32', spawn, signal: ctrl.signal })
    ctrl.abort()
    expect(await p).toMatchObject({ aborted: true })
    expect(calls[1].args).toEqual(['/PID', String(calls[0].child.pid), '/T', '/F'])
  })
})

describe('environments', () => {
  it('one PATH, whatever its case; no ANTHROPIC_* / OPENAI_*', () => {
    const e = vendorEnv({ Path: 'C:\\a', OPENAI_BASE_URL: 'x', anthropic_api_key: 'y', KEEP: '1' }, { PATH: 'C:\\b' })
    expect(e).toEqual({ KEEP: '1', PATH: 'C:\\b' })
  })

  it('the test switch: a throwaway home, a bare system PATH, both CLIs\' config folders inside it, BROWSER passed through', () => {
    expect(testVendorEnv({ PATH: 'x' }, 'win32')).toBeNull()
    const w = testVendorEnv({ REELSTUDIO_TEST_VENDOR_HOME: 'C:\\t', Path: 'C:\\Users\\me\\.local\\bin', SystemRoot: 'C:\\Windows', REELSTUDIO_TEST_BROWSER: 'C:\\t\\capture.cmd', OPENAI_API_KEY: 'k' }, 'win32')!
    expect(w).toMatchObject({ USERPROFILE: 'C:\\t', HOME: 'C:\\t', LOCALAPPDATA: 'C:\\t\\AppData\\Local', APPDATA: 'C:\\t\\AppData\\Roaming', CLAUDE_CONFIG_DIR: 'C:\\t\\.claude', CODEX_HOME: 'C:\\t\\.codex', BROWSER: 'C:\\t\\capture.cmd' })
    expect(w.PATH).toBe('C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0')
    expect(Object.keys(w).filter((k) => k.toLowerCase() === 'path')).toEqual(['PATH'])
    expect(w.OPENAI_API_KEY).toBeUndefined()
    expect(testVendorEnv({ REELSTUDIO_TEST_VENDOR_HOME: '/tmp/t', PATH: '/opt/homebrew/bin' }, 'darwin')).toMatchObject({ HOME: '/tmp/t', PATH: '/usr/bin:/bin:/usr/sbin:/sbin', CODEX_HOME: '/tmp/t/.codex' })
  })

  it('the test switch, sign-in step: the REAL home stays (the browser opens their own profile), only the config folders are throwaway', () => {
    expect(testVendorLoginEnv({ PATH: 'x' }, 'win32')).toBeNull()
    const base = { REELSTUDIO_TEST_VENDOR_HOME: 'C:\\t', USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', Path: 'C:\\real', OPENAI_API_KEY: 'k' }
    const w = testVendorLoginEnv(base, 'win32')!
    expect(w).toMatchObject({ USERPROFILE: 'C:\\Users\\me', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', Path: 'C:\\real', CLAUDE_CONFIG_DIR: 'C:\\t\\.claude', CODEX_HOME: 'C:\\t\\.codex' })
    expect(w.OPENAI_API_KEY).toBeUndefined()
    expect(testVendorLoginEnv({ REELSTUDIO_TEST_VENDOR_HOME: '/tmp/t', HOME: '/Users/me' }, 'darwin')).toMatchObject({ HOME: '/Users/me', CLAUDE_CONFIG_DIR: '/tmp/t/.claude', CODEX_HOME: '/tmp/t/.codex' })
  })
})

// ---- the flow ---------------------------------------------------------------------------------------------------------

function flow(o: {
  states: CliStatus[]
  login?: (signal: AbortSignal, n: number, onDeviceCode?: (d: { url: string; code: string }) => void) => Promise<{ code: number | null; portBusy?: boolean; aborted?: boolean; deviceCodeOff?: boolean }>
  loginTimeoutMs?: number
}) {
  const seen: VendorInfo[] = []
  const selected: string[] = []
  const states = [...o.states]
  let logins = 0
  const deps: VendorDeps = {
    status: async () => (states.length > 1 ? states.shift()! : states[0]),
    login: async (_v, _bin, signal, onDeviceCode) => (o.login ?? (async () => ({ code: 0 })))(signal, ++logins, onDeviceCode),
    select: async (v) => void selected.push(v),
    emit: (i) => void seen.push(i),
    loginTimeoutMs: o.loginTimeoutMs
  }
  return { vc: createVendorConnect(deps), seen, selected, steps: () => seen.map((i) => i.step), counts: () => ({ logins }) }
}
const BIN = '/Users/p/.local/bin/claude'
const missing: CliStatus = { state: 'missing' }
const out: CliStatus = { state: 'signed_out', bin: BIN, version: '2.1.310' }
const ready: CliStatus = { state: 'ready', bin: BIN, version: '2.1.310', plan: 'max' }
const PORT_LINE = (): string => VENDOR_MESSAGES.port_busy('chatgpt')
const DEVICE_CODE_OFF_LINE = (): string => (VENDOR_MESSAGES as Record<string, (v: 'chatgpt') => string>).device_code_off('chatgpt')
const hang = (signal: AbortSignal) => new Promise<{ code: null; aborted: true }>((r) => signal.addEventListener('abort', () => r({ code: null, aborted: true })))

describe('Use: sign in if needed, check, choose; never install', () => {
  it('signed out: signing in, checking, done, and only then it becomes the AI editor', async () => {
    const f = flow({ states: [out, ready] })
    const end = await f.vc.connect('claude')
    expect(f.steps()).toEqual(['signing_in', 'checking', 'done'])
    expect(end).toMatchObject({ vendor: 'claude', state: 'ready', step: 'done', version: '2.1.310', plan: 'max' })
    expect(f.selected).toEqual(['claude'])
  })

  it('not on this computer: nothing runs and nothing is chosen (the row links to the install page)', async () => {
    const f = flow({ states: [missing] })
    expect(await f.vc.connect('claude')).toMatchObject({ vendor: 'claude', state: 'missing', step: 'idle' })
    expect(f.counts()).toEqual({ logins: 0 })
    expect(f.selected).toEqual([])
  })

  it('already signed in: no install, no browser, chosen at once', async () => {
    const f = flow({ states: [ready] })
    await f.vc.connect('chatgpt')
    expect(f.steps()).toEqual(['done'])
    expect(f.counts()).toEqual({ logins: 0 })
    expect(f.selected).toEqual(['chatgpt'])
  })

  it('the page never learns where the app is', async () => {
    const f = flow({ states: [out, ready] })
    await f.vc.connect('claude')
    expect(JSON.stringify([...f.seen, await f.vc.status('claude')])).not.toContain(BIN)
  })

  it('sign-in ended without signing in, port busy, or nobody came back in time', async () => {
    expect(await flow({ states: [out, out], login: async () => ({ code: 1 }) }).vc.connect('claude')).toMatchObject({ problem: 'sign_in_failed', message: "The sign-in didn’t finish. Try again." })
    expect(await flow({ states: [out], login: async () => ({ code: 1, portBusy: true }) }).vc.connect('chatgpt')).toMatchObject({ problem: 'port_busy', message: PORT_LINE() })
    const slow = flow({ states: [out], login: hang, loginTimeoutMs: 20 })
    expect(await slow.vc.connect('claude')).toMatchObject({ problem: 'sign_in_timeout' })
    expect(slow.selected).toEqual([])
  })

  it('Cancel before the sign-in even started: it never starts', async () => {
    const f = flow({ states: [out], login: hang })
    const p = f.vc.connect('claude')
    f.vc.cancel('claude')
    expect(await p).toMatchObject({ step: 'idle', problem: 'cancelled' })
    expect(f.counts().logins).toBe(0)
  })

  it('Cancel while the browser page is open: back to the button, nothing chosen', async () => {
    const f = flow({ states: [out], login: hang })
    const p = f.vc.connect('claude')
    await new Promise((r) => setTimeout(r, 5))
    expect(f.vc.running('claude')).toBe(true)
    f.vc.cancel('claude')
    expect(await p).toMatchObject({ step: 'idle', problem: 'cancelled' })
    expect(f.selected).toEqual([])
    expect(f.vc.running('claude')).toBe(false)
  })

  it('"Open the sign-in page again" starts a fresh sign-in (a fresh page), then it finishes', async () => {
    const f = flow({ states: [out, ready], login: (signal, n) => (n === 1 ? hang(signal) : Promise.resolve({ code: 0 })) })
    const p = f.vc.connect('claude')
    await new Promise((r) => setTimeout(r, 5))
    expect(f.vc.signInAgain('claude')).toBe(true)
    expect(await p).toMatchObject({ step: 'done' })
    expect(f.counts().logins).toBe(2)
    expect(f.steps()).toEqual(['signing_in', 'signing_in', 'checking', 'done'])
  })

  it('a Claude plan the app reports as free is never chosen', async () => {
    const f = flow({ states: [out, { ...ready, plan: 'free' }] })
    expect(await f.vc.connect('claude')).toMatchObject({ step: 'failed', problem: 'free_plan', message: expect.stringContaining('Claude Pro or Max') })
    expect(f.selected).toEqual([])
  })

  it('choosing ChatGPT stops a Claude sign-in that is still waiting', async () => {
    const seen: VendorInfo[] = []
    const vc = createVendorConnect({
      status: async (v) => (v === 'claude' ? out : ready),
      login: async (_v, _b, signal) => hang(signal),
      select: async () => undefined,
      emit: (i) => void seen.push(i)
    })
    const claude = vc.connect('claude')
    await new Promise((r) => setTimeout(r, 5))
    await vc.connect('chatgpt')
    expect(await claude).toMatchObject({ vendor: 'claude', step: 'idle', problem: 'cancelled' })
  })

  it('a second click while it runs joins the same connect', async () => {
    const f = flow({ states: [out], login: hang })
    const a = f.vc.connect('claude')
    const b = f.vc.connect('claude')
    await new Promise((r) => setTimeout(r, 5))
    f.vc.cancel('claude')
    expect(await a).toBe(await b)
    expect(f.counts().logins).toBe(1)
  })

  // On beta, choosing Claude sends it one short message first (ai index.ts setActive), which can fail or be cancelled.
  it('fails if a choice the AI refuses reads as an unfinished sign-in instead of saying why', async () => {
    const seen: VendorInfo[] = []
    const vc = createVendorConnect({
      status: async () => ready,
      login: async () => ({ code: 0 }),
      select: async () => { throw { code: 'CHECK_FAILED', userMessage: 'The account in your Claude Code app has hit its weekly limit. It resets tomorrow at 9:00 AM (in 14 h).' } },
      emit: (i) => void seen.push(i)
    })
    expect(await vc.connect('claude')).toMatchObject({ step: 'failed', problem: 'sign_in_failed', message: 'The account in your Claude Code app has hit its weekly limit. It resets tomorrow at 9:00 AM (in 14 h).' })
  })

  it('fails if Cancel during that first message leaves it running or reads as a failure', async () => {
    let stopped = false
    const vc = createVendorConnect({
      status: async () => ready,
      login: async () => ({ code: 0 }),
      select: (_v, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { stopped = true; reject({ code: 'cancelled' }) })),
      emit: () => undefined
    })
    const p = vc.connect('claude')
    await new Promise((r) => setTimeout(r, 5))
    vc.cancel('claude')
    expect(await p).toMatchObject({ step: 'idle', problem: 'cancelled' })
    expect(stopped).toBe(true)
  })

  it('the port case tells the page whether the port is reserved (the code first) or only in use (Try again first)', async () => {
    const reserved = await flow({ states: [out], login: async () => ({ code: 1, portBusy: true, portReserved: true }) }).vc.connect('chatgpt')
    expect(reserved).toMatchObject({ step: 'failed', problem: 'port_busy', portReserved: true })
    const inUse = await flow({ states: [out], login: async () => ({ code: 1, portBusy: true }) }).vc.connect('chatgpt')
    expect(inUse).toMatchObject({ step: 'failed', problem: 'port_busy' })
    expect(inUse.portReserved).toBeUndefined()
  })

  it("ChatGPT’s port held: plain words; Sign in with a code instead runs the code sign-in, shows its code, then checks and chooses", async () => {
    const page = { url: 'https://auth.openai.com/codex/device', code: 'Q42W-7R5TB' }
    const f = flow({
      states: [out, out, ready], // the browser try, the code try, then the check
      login: async (_s, n, onDeviceCode) => {
        if (n === 1) return { code: 1, portBusy: true } // the browser sign-in: the port is held
        expect(onDeviceCode).toBeTypeOf('function') // the second is the code sign-in
        onDeviceCode!(page)
        return { code: 0 }
      }
    })
    expect(await f.vc.connect('chatgpt')).toMatchObject({ step: 'failed', problem: 'port_busy', message: PORT_LINE() })
    // in use or reserved, the same plain line: something else holds the port
    expect(PORT_LINE()).toBe(process.platform === 'win32' ? "Another program or Windows is holding the port ChatGPT’s sign-in uses." : "Another program is holding the port ChatGPT’s sign-in uses.")
    const end = await f.vc.signInWithCode('chatgpt')
    expect(end).toMatchObject({ step: 'done', state: 'ready' })
    expect(f.selected).toEqual(['chatgpt'])
    const code = f.seen.filter((i) => i.signIn === 'code')
    expect(code.map((i) => i.step)).toEqual(['signing_in', 'signing_in'])
    expect(code[0].deviceCode).toBeUndefined() // "getting a code"
    expect(code[1].deviceCode).toEqual(page)
    expect(f.seen.at(-1)!.deviceCode).toBeUndefined() // the code is gone once it is used
  })

  it('the code sign-in: Cancel ends it, there is no "open again" (a new code each time), and only ChatGPT has one', async () => {
    const f = flow({ states: [out], login: hang })
    const p = f.vc.signInWithCode('chatgpt')
    await new Promise((r) => setTimeout(r, 5))
    expect(f.vc.signInAgain('chatgpt')).toBe(false)
    f.vc.cancel('chatgpt')
    expect(await p).toMatchObject({ step: 'idle', problem: 'cancelled' })
    expect(f.selected).toEqual([])
    await expect(flow({ states: [out] }).vc.signInWithCode('claude' as never)).rejects.toMatchObject({ code: 'BAD_INPUT' })
  })

  it('code sign-in turned off: says where to turn it on, not a generic failure', async () => {
    const f = flow({ states: [out], login: async () => ({ code: 1, deviceCodeOff: true }) })
    expect(await f.vc.signInWithCode('chatgpt')).toMatchObject({ step: 'failed', problem: 'device_code_off', message: DEVICE_CODE_OFF_LINE() })
    expect(DEVICE_CODE_OFF_LINE()).toContain("ChatGPT’s security settings")
  })

  // A sign-in makes Codex clear the credentials it has first, so an unclear status (slow, an error answer) must never
  // start one on its own: only the person's "Sign in" does.
  const unknown = { state: 'signed_out', bin: '/x/codex', version: '0.165.0', unknown: true } as CliStatus

  it("ChatGPT’s status unknown: Connect says so and starts no sign-in", async () => {
    const f = flow({ states: [unknown] })
    expect(await f.vc.connect('chatgpt')).toMatchObject({ step: 'failed', problem: 'status_unknown', message: "Couldn’t tell whether ChatGPT is signed in." })
    expect(f.counts()).toEqual({ logins: 0 })
    expect(f.selected).toEqual([])
  })

  it('the card shows it before any click; Sign in is the person\'s explicit choice and does start the sign-in', async () => {
    const f = flow({ states: [unknown, unknown, ready] })
    expect(await f.vc.status('chatgpt')).toMatchObject({ step: 'idle', problem: 'status_unknown', message: "Couldn’t tell whether ChatGPT is signed in." })
    expect(await f.vc.signIn('chatgpt')).toMatchObject({ step: 'done' })
    expect(f.counts().logins).toBe(1)
    expect(f.selected).toEqual(['chatgpt'])
  })

  it('a clear "signed out" still signs in at once, as before', async () => {
    const f = flow({ states: [{ state: 'signed_out', bin: '/x/codex', version: '0.165.0' }, ready] })
    expect(await f.vc.connect('chatgpt')).toMatchObject({ step: 'done' })
    expect(f.counts().logins).toBe(1)
  })

  it('the old in-app ChatGPT sign-in was retired: the ChatGPT card says why, until it is connected', async () => {
    const f = flow({ states: [{ state: 'missing', chatgptMoved: true }] })
    expect(await f.vc.status('chatgpt')).toMatchObject({ step: 'idle', message: MOVED_NOTE })
    expect((await f.vc.status('claude')).message).toBeUndefined()
  })
})

// On this Mac the Claude Code app's account was at its weekly limit, and the app's check said only "Your Claude plan is
// at its limit. Try again after it resets.", dropping the reset time Claude Code gave it.
describe('choosing Claude when its plan is at a limit', () => {
  it('fails if the words drop which limit it hit or when it resets', () => {
    const said = 'The account in your Claude Code app has hit its weekly limit. It resets tomorrow at 9:00 AM (in 14 h).'
    expect(claudeCheckWords({ code: 'cli_limited', userMessage: said, resetsAt: '2026-10-29T14:00:00.000Z' }, 'darwin')).toBe(said)
  })
})

