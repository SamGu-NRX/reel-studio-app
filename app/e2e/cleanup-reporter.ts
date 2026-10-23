import type { Reporter } from '@playwright/test/reporter'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** One folder for the run's workers (helpers.ts BASE); removed at the end unless KEEP_E2E_TMP=1. */
export default class CleanupReporter implements Reporter {
  private root = mkdtempSync(join(tmpdir(), 'rs-e2e-run-'))

  constructor() {
    process.env.REELSTUDIO_E2E_TMP = this.root
  }

  onEnd(): void {
    if (process.env.KEEP_E2E_TMP === '1') console.log(`Kept e2e files: ${this.root}`)
    else rmSync(this.root, { recursive: true, force: true })
  }
}
