// One temp folder per test run. TMPDIR, TMP and TEMP point into it before any worker starts, so every tmpdir() call in
// the tests, their helpers (tmpDir) and the processes they start (engine, uv, ffmpeg) lands there, and the main
// process removes it when the run ends. Before this, nothing removed them: about 5,000 folders (4.2 GiB) piled up in
// the system temp folder in a day of test runs (2026-10-29). A per-file setup missed files whose tests were all
// skipped, whose workers end without running afterAll or an exit handler.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  // A short name on purpose: the MCP run's Unix socket (src/mcp/run.ts) nests two folders deeper and must stay
  // under macOS's 104-byte socket path limit (102 bytes with this folder on a Mac's /var/folders temp).
  const root = mkdtempSync(join(tmpdir(), 'rsv'));
  process.env.TMPDIR = process.env.TMP = process.env.TEMP = root;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };
}
