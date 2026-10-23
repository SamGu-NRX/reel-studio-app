// `npm run try:browser` (repo root): the browser prototype with nothing of yours involved. A throwaway Reel Studio
// folder and app profile, the stand-in engine and AI, and the app with its browser server on (main/server). The app
// opens a one-time pairing link in your default browser; File > Open in Browser makes another. Quitting the app
// removes the throwaway folder.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = mkdtempSync(join(tmpdir(), 'rs-try-browser-'))
const env = {
  ...process.env,
  REELSTUDIO_BROWSER: '1',
  REELSTUDIO_ROOT: join(base, 'Reel Studio'),
  REELSTUDIO_USER_DATA: join(base, 'user data'),
  REELSTUDIO_MODELS_DIR: join(base, 'models'),
  REELSTUDIO_ENGINE_DIR: join(APP, 'dev', 'fake-engine'),
  REELSTUDIO_MOCK_AI: '1',
  // a stand-in "Claude Code app" that is signed in: choose it in Settings and a note makes a new version
  REELSTUDIO_MOCK_CLAUDE: 'ready'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.CLIPROXY_API_KEY
console.log(`Throwaway data in ${base} (removed when the app quits)`)

const bin = join(dirname(createRequire(import.meta.url).resolve('electron-vite/package.json')), 'bin', 'electron-vite.js')
// preview = build, then run the built app; the browser server serves that build (out/renderer)
const child = spawn(process.execPath, [bin, 'preview'], { cwd: APP, stdio: 'inherit', env })
child.on('exit', (code) => {
  rmSync(base, { recursive: true, force: true })
  process.exit(code ?? 1)
})
