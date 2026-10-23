// Instagram API v26.0: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
// App settings (not user content): first-run flag and storage location.
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { settingsFile } from './paths'
import { writeJson } from './store'
import type { InstagramSettings } from '../shared/instagram'
import { UPDATE_DEFAULTS, type UpdateState } from './update-check'

export interface Settings extends UpdateState, InstagramSettings {
  firstRunDone: boolean
  root: string | null
  /** Written by the 0.1.0/0.1.1 local-Claude-Code builds (a one-time automatic AI pick); read once by ai-carryover.ts. */
  aiAutoPicked: boolean
  /** ai-carryover.ts already ran (it kept, or left alone, what an old local-Claude-Code install was using) */
  aiCarriedOver: boolean
}

const DEFAULTS: Settings = {
  firstRunDone: false, root: null, aiAutoPicked: false, aiCarriedOver: false, ...UPDATE_DEFAULTS,
  // Connection and publishing stay opt-in until the broker and Meta app have been configured.
  instagramEnabled: false, instagramAppId: null, instagramBrokerUrl: null, instagramUploadOrigins: []
}

export async function loadSettings(): Promise<Settings> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await fs.readFile(settingsFile(), 'utf8')) }
  } catch {
    return { ...DEFAULTS }
  }
}

// One save at a time: each is read-modify-write, and the update check (main/update-check.ts) saves in the
// background, so two overlapping saves must not drop each other's change (e.g. firstRunDone).
let queue: Promise<unknown> = Promise.resolve()

export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const run = async (): Promise<Settings> => {
    const next = { ...(await loadSettings()), ...patch }
    await fs.mkdir(dirname(settingsFile()), { recursive: true })
    // Same writer as projects: unique temp file + rename that retries on Windows locks (review 32).
    await writeJson(settingsFile(), next)
    return next
  }
  const p = queue.then(run, run)
  queue = p.catch(() => undefined)
  return p
}
