// The contract's calls (shared/contract.ts), implemented once. The desktop window reaches them over IPC (index.ts)
// and a browser over the loopback server (server/); both go through `dispatch`, which checks the arguments first.
// No electron import: tests run it in Node with the stand-in engine and AI.
import type { AppInfo, ModelStatus, UpdateStatus } from '../shared/api'
import { checkArgs, type Method, type MethodResult } from '../shared/contract'
import type { AI } from './ai-types'
import { publicInfo } from './claude-signin'
import type { JobManager } from './jobs'
import { detail, listProjects } from './store'

export interface ServiceDeps {
  info(): Promise<AppInfo>
  /** The AI is loaded after the window opens, so it is looked up on each call. */
  ai(): AI
  jobs: JobManager
  models: { status(): ModelStatus | Promise<ModelStatus> }
  updates: { status(): Promise<UpdateStatus> }
}

type Handlers = { [M in Method]: (...args: any[]) => Promise<MethodResult<M>> }

export function createService(d: ServiceDeps) {
  const handlers: Handlers = {
    'app.info': () => d.info(),
    'projects.list': () => listProjects(),
    'projects.get': async (slug: string) => {
      const p = await detail(slug)
      const running = d.jobs.forSlug(slug)
      p.job = running
        ? { id: running.id, kind: running.kind, message: running.message, pct: running.pct, overall: running.overall, secondsLeft: running.secondsLeft, overdue: running.overdue, thinking: running.thinking }
        : null
      if (!running && p.status === 'working') p.status = 'interrupted'
      return p
    },
    'ai.active': () => d.ai().active(),
    'ai.providers': () => d.ai().providers(),
    // The page gets the state only; the sign-in happens in Anthropic's CLI (desktop).
    'ai.claudeCodeStatus': async () => publicInfo((await d.ai().claudeCodeStatus?.()) ?? { state: 'missing' }),
    'model.status': async () => d.models.status(),
    'update.status': () => d.updates.status(),
    'style.rules': () => d.ai().styleRules()
  }

  return {
    /** Runs one call after checking its arguments. Throws a UserError-shaped value on failure. */
    async dispatch(method: unknown, args: unknown): Promise<unknown> {
      const checked = checkArgs(method, args)
      return (handlers[method as Method] as (...a: unknown[]) => Promise<unknown>)(...checked)
    }
  }
}

export type Service = ReturnType<typeof createService>
