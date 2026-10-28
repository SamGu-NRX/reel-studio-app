// The test switch's put-back of the user PATH (main/user-path.ts) against the real Windows registry: a throwaway
// HKCU\Software\ReelStudioTest-* key, never HKCU\Environment. The values are set and read through the registry API
// (base64 over the command line), so these helpers cannot mangle what they check.
import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { withUserPathKept } from '../src/main/user-path'

const ps = (script: string): string => {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error(`powershell failed: ${r.stderr}`)
  return r.stdout.trim()
}
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
const setPath = (key: string, value: string | number, kind: 'String' | 'ExpandString' | 'DWord'): void => {
  const v = typeof value === 'number' ? String(value) : `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}'))`
  ps(`[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key}').SetValue('Path', ${v}, '${kind}')`)
}
const getPath = (key: string): { kind: string; value: string } | null => {
  const out = ps(
    `$k = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key}'); if ($null -eq $k -or $null -eq $k.GetValue('Path')) { 'none' } ` +
      `else { '' + $k.GetValueKind('Path') + ' ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$k.GetValue('Path', $null, 'DoNotExpandEnvironmentNames'))) }`
  )
  if (out === 'none') return null
  const [kind, data = ''] = out.split(' ')
  return { kind, value: Buffer.from(data, 'base64').toString('utf8') }
}

describe.skipIf(process.platform !== 'win32')('user PATH put back after a test install (Windows registry)', () => {
  const keys: string[] = []
  const tempKey = (): string => {
    const k = `Software\\ReelStudioTest-${process.pid}-${Date.now()}-${keys.length}`
    keys.push(k)
    return k
  }
  afterEach(() => {
    for (const k of keys.splice(0)) spawnSync('reg.exe', ['delete', `HKCU\\${k}`, '/f'], { windowsHide: true })
  })

  it('a user PATH with non-ASCII folders comes back exactly, type included, after an installer rewrites it', async () => {
    const key = tempKey()
    // an accented user folder is common; `reg query` prints it in the console's code page, not UTF-8
    const value = 'C:\\Users\\Zoë Müller\\bin;C:\\工具\\bin;%USERPROFILE%\\.dotnet\\tools'
    setPath(key, value, 'ExpandString')
    // what OpenAI's installer does: prepends its folder and saves the value as REG_SZ
    await withUserPathKept(async () => setPath(key, `C:\\Users\\Zoë Müller\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin;${value}`, 'String'), () => undefined, key)
    expect(getPath(key)).toEqual({ kind: 'ExpandString', value })
  })

  it('a user PATH it cannot read is left alone, never deleted', async () => {
    const key = tempKey()
    setPath(key, 5, 'DWord') // not a string: there is nothing it can faithfully write back
    await withUserPathKept(async () => undefined, () => undefined, key)
    expect(getPath(key)).toEqual({ kind: 'DWord', value: '5' })
  })
})
