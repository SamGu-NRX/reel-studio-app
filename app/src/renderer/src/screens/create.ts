import { describeSorted } from '../../../shared/describe'
export { describeSorted }
import { reel, userMessage } from '../api'
import type { Go } from '../nav'

type Notify = (t: string, k?: 'error' | 'info') => void

/** Starts a new reel from dropped or picked files and opens it, where its first edit runs. Non-video files go to the Library. */
export async function createFromFiles(paths: string[], go: Go, notify: Notify, onError?: (message: string) => void): Promise<boolean> {
  try {
    const r = await reel.projects.create(paths)
    go({ name: 'reel', slug: r.slug })
    // After the screen change, which clears toasts: say where the other files went.
    if (r.skipped.length) notify(describeSorted(r.skipped))
    return true
  } catch (e) {
    if (onError) onError(userMessage(e))
    else notify(userMessage(e), 'error')
    return false
  }
}

/** New reel: one with no video yet, opened to plan it. */
export async function newReel(go: Go, notify: Notify): Promise<void> {
  try {
    go({ name: 'reel', slug: (await reel.projects.plan()).slug })
  } catch (e) {
    notify(userMessage(e), 'error')
  }
}

/** Demo build: Suggest a reel for me. Opens a reel Rundown picked, with its edit already running. */
export async function suggestReel(go: Go, notify: Notify): Promise<void> {
  try {
    go({ name: 'reel', slug: (await reel.projects.suggest()).slug })
  } catch (e) {
    notify(userMessage(e), 'error')
  }
}
