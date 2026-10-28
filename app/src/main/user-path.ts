// Test switch only (REELSTUDIO_TEST_VENDOR_HOME, Windows): OpenAI's Codex installer adds its folder to the user PATH
// and rewrites the value's type (REG_EXPAND_SZ -> REG_SZ; measured 2026-10-25). A test install into a throwaway home
// must leave the real PATH exactly as it was, so it is read before and written back after.
import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

const system32 = (...p: string[]): string => win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', ...p)

function run(cmd: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = ''
    const c = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    c.stdout.on('data', (d) => (out += String(d)))
    c.on('error', () => resolve({ code: -1, out }))
    c.on('close', (code) => resolve({ code, out }))
  })
}

/**
 * Reads Path through the registry API and prints `<kind> <base64 of its UTF-8 bytes>`, or `none`. Not `reg query`: it
 * prints in the console's code page (936, 437, 850, ...), so decoding it as UTF-8 turned every non-ASCII folder into
 * U+FFFD, and the put-back then wrote that over the real PATH. The output here is ASCII whatever the code page.
 */
const READ = (key: string): string =>
  `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); if ($null -eq $k -or $null -eq $k.GetValue('Path')) { 'none' } ` +
  `else { '' + $k.GetValueKind('Path') + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$k.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'))) }`

export type UserPath = { type: 'REG_SZ' | 'REG_EXPAND_SZ'; value: string } | 'none'

/** READ's output -> the value, 'none' when there is no Path, or null when it could not be read as a string. */
export function parseUserPath(out: string): UserPath | null {
  const s = out.trim()
  if (s === 'none') return 'none'
  const m = /^(String|ExpandString)(?: ([A-Za-z0-9+/]*={0,2}))?$/.exec(s)
  if (!m) return null
  return { type: m[1] === 'String' ? 'REG_SZ' : 'REG_EXPAND_SZ', value: Buffer.from(m[2] ?? '', 'base64').toString('utf8') }
}

/** `key`: the HKCU subkey holding Path; only tests change it, so they never touch the real user PATH. */
export async function withUserPathKept<T>(fn: () => Promise<T>, log: (s: string) => void, key = 'Environment'): Promise<T> {
  const read = await run(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', READ(key)])
  const before = read.code === 0 ? parseUserPath(read.out) : null
  try {
    return await fn()
  } finally {
    // Not read is not "no PATH": deleting it then would lose the person's whole user PATH.
    if (before === null) {
      log(`[vendor] test switch: the user PATH could not be read before the install, so it was not put back (powershell exit ${read.code})`)
    } else {
      const r =
        before === 'none'
          ? await run(system32('reg.exe'), ['delete', `HKCU\\${key}`, '/v', 'Path', '/f'])
          : await run(system32('reg.exe'), ['add', `HKCU\\${key}`, '/v', 'Path', '/t', before.type, '/d', before.value, '/f'])
      log(`[vendor] test switch: user PATH put back (${before === 'none' ? 'none' : before.type}), reg exit ${r.code}`)
    }
  }
}
