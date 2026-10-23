// The contract between the page and the computer that owns the videos: which calls and events exist, and what
// arguments each call accepts. The desktop window carries it over IPC (preload/index.ts), a browser over a WebSocket
// (main/server). Main validates every call's arguments here before it runs (main/service.ts), so nothing a page sends
// is trusted for its shape. Signatures are ReelApi's (shared/api.ts); this file adds the list and the checks.
//
// Everything else on ReelApi (file pickers, Finder, drag-out, the clipboard, phone sharing, changing settings) is a
// desktop capability, not part of this contract. Keep free of Node and DOM imports.
import type { ReelApi, UserError } from './api'

/** Bumped when a call or event changes shape; the server refuses clients of another version. */
export const CONTRACT_VERSION = 1

const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u

export class BadRequest implements UserError {
  readonly code = 'BAD_REQUEST'
  readonly userMessage = 'Reel Studio did not understand that request. Reload the page and try again.'
  constructor(readonly detail: string) {}
}

type Check = (args: unknown[]) => unknown[]

const none: Check = (args) => {
  if (args.length) throw new BadRequest('takes no arguments')
  return []
}

const slugOnly: Check = (args) => {
  if (args.length !== 1) throw new BadRequest('takes one argument')
  return [slug(args[0])]
}

export function slug(v: unknown): string {
  if (typeof v !== 'string' || v.length > 200 || !SLUG.test(v)) throw new BadRequest('bad slug')
  return v
}

/** Every call in the contract, with its argument check. The IPC channel is the name with ':' (`projects:get`). */
export const METHODS = {
  'app.info': none,
  'projects.list': none,
  'projects.get': slugOnly,
  'ai.active': none,
  'ai.providers': none,
  'ai.claudeCodeStatus': none,
  'model.status': none,
  'update.status': none,
  'style.rules': none
} satisfies Record<string, Check>

export type Method = keyof typeof METHODS

/** Events main pushes to every page, with the IPC channel each used before this contract existed. */
export const EVENTS = { job: 'job:event', model: 'model:progress', update: 'update:change' } as const
export type EventName = keyof typeof EVENTS

type Fn<M extends string> = M extends `${infer N}.${infer F}`
  ? N extends keyof ReelApi
    ? F extends keyof ReelApi[N]
      ? ReelApi[N][F]
      : never
    : never
  : never

export type MethodFn<M extends Method> = Fn<M>
export type MethodResult<M extends Method> = Awaited<ReturnType<Extract<Fn<M>, (...a: never[]) => unknown>>>
export type EventPayload<E extends EventName> = E extends 'job'
  ? Parameters<Parameters<ReelApi['jobs']['onEvent']>[0]>[0]
  : E extends 'model'
    ? Parameters<Parameters<ReelApi['model']['onProgress']>[0]>[0]
    : Parameters<Parameters<ReelApi['update']['onChange']>[0]>[0]

export const isMethod = (m: unknown): m is Method => typeof m === 'string' && Object.prototype.hasOwnProperty.call(METHODS, m)

/** Checks a call's arguments; throws BadRequest for an unknown method or arguments of the wrong shape. */
export function checkArgs(method: unknown, args: unknown): unknown[] {
  if (!isMethod(method)) throw new BadRequest('unknown method')
  if (!Array.isArray(args)) throw new BadRequest('arguments must be a list')
  return METHODS[method](args)
}

export const channelFor = (m: Method): string => m.replace('.', ':')

/** The contract's half of ReelApi: what any page can do, wherever it runs. */
export interface ContractClient {
  app: Pick<ReelApi['app'], 'info'>
  projects: Pick<ReelApi['projects'], 'list' | 'get'>
  ai: Pick<ReelApi['ai'], 'active' | 'providers' | 'claudeCodeStatus'>
  model: Pick<ReelApi['model'], 'status' | 'onProgress'>
  update: Pick<ReelApi['update'], 'status' | 'onChange'>
  style: Pick<ReelApi['style'], 'rules'>
  jobs: Pick<ReelApi['jobs'], 'onEvent'>
}

export interface Transport {
  call(method: Method, args: unknown[]): Promise<unknown>
  on(event: EventName, cb: (payload: unknown) => void): () => void
}

/** The contract client over any transport. */
export function createContractClient(t: Transport): ContractClient {
  const call =
    <M extends Method>(m: M) =>
    (...args: unknown[]) =>
      t.call(m, args) as Promise<MethodResult<M>>
  const on =
    <E extends EventName>(e: E) =>
    (cb: (p: EventPayload<E>) => void) =>
      t.on(e, (p) => cb(p as EventPayload<E>))
  return {
    app: { info: call('app.info') },
    projects: { list: call('projects.list'), get: call('projects.get') },
    ai: { active: call('ai.active'), providers: call('ai.providers'), claudeCodeStatus: call('ai.claudeCodeStatus') },
    model: { status: call('model.status'), onProgress: on('model') },
    update: { status: call('update.status'), onChange: on('update') },
    style: { rules: call('style.rules') },
    jobs: { onEvent: on('job') }
  }
}
