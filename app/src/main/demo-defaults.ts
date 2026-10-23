// demo/spurs-showcase only: the hackathon build opens on the demo library in demo mode with no environment set, so a
// double-clicked .app behaves like `npm run dev` with REELSTUDIO_DEMO=1 and the demo REELSTUDIO_ROOT. Imported first
// in index.ts so every later module reads these.
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

process.env.REELSTUDIO_DEMO ??= '1'
process.env.REELSTUDIO_ROOT ??= join(homedir(), 'Movies', 'Rundown Demo', 'Reel Studio')

// This packaged build carries no Python or ffmpeg of its own (packaging/runtime is a stub): it uses this Mac's.
if (app.isPackaged) {
  const venv = join(homedir(), 'Programming Projects', 'reel-studio-app-wt', 'spurs-match', 'engine', '.venv', 'bin', 'python')
  if (existsSync(venv)) process.env.REELSTUDIO_PYTHON ??= venv
  for (const [k, bin] of [['REELENGINE_FFMPEG', 'ffmpeg'], ['REELENGINE_FFPROBE', 'ffprobe']] as const) {
    const p = ['/opt/homebrew/bin', '/usr/local/bin'].map((d) => join(d, bin)).find(existsSync)
    if (p) process.env[k] ??= p
  }
}
