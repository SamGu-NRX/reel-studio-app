// The name on the sidebar's account row: the computer account's full name, read once.
import { execFile } from 'node:child_process'
import { userInfo } from 'node:os'

/** macOS: the account's full name (`id -F`). Elsewhere, or if that fails: the login name. null when neither is known. */
export async function accountName(platform: NodeJS.Platform = process.platform): Promise<string | null> {
  if (platform === 'darwin') {
    const full = await new Promise<string>((resolve) => {
      execFile('/usr/bin/id', ['-F'], { timeout: 1500 }, (err, out) => resolve(err ? '' : String(out).trim()))
    })
    if (full) return full
  }
  try {
    return userInfo().username || null
  } catch {
    return null
  }
}
