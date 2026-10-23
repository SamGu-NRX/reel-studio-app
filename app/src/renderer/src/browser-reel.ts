// window.reel for a page opened in a browser (renderer/src/api.ts picks it when there is no preload). The contract
// (shared/contract.ts) goes over the server's WebSocket (main/server); everything else on ReelApi belongs to the desktop
// app on this computer, and here it fails with a message that says so instead of doing nothing.
//
// Signing in (main/server/auth.ts): a pairing link lands on /#pair=<code>. This page makes an ECDSA P-256 key pair
// whose private half cannot be exported, keeps it in this origin's IndexedDB, and registers the public half with the
// code. Each socket then signs the server's challenge. No cookie: cookies would also go to every other local port.
import type { ReelApi, UserError } from '../../shared/api'
import { WS_PROTOCOL, createContractClient, type EventName, type Method } from '../../shared/contract'

/** What the page shows about its link to the computer (components/ConnectionBanner.tsx). */
export type Connection = 'connecting' | 'open' | 'reconnecting' | 'signed-out' | 'link-expired' | 'stopped'

export const LOCAL_ONLY = 'LOCAL_ONLY'

/** "Exporting works in the Reel Studio app on this computer." */
export function localOnlyError(what: string): UserError {
  return { code: LOCAL_ONLY, userMessage: `${what} works in the Reel Studio app on this computer.` }
}

const OFFLINE: UserError = { code: 'OFFLINE', userMessage: 'Lost the link to Reel Studio on this computer. Try again in a moment.' }
const SIGNED_OUT: UserError = {
  code: 'SIGNED_OUT',
  userMessage: 'This browser is not signed in. In Reel Studio on this computer, choose File › Open in Browser.'
}

/** main/server CLOSE_SIGNED_OUT */
const CLOSE_SIGNED_OUT = 4401
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

// ---- the device key, in this origin's IndexedDB ------------------------------------------------------------------

type Device = { id: string; key: CryptoKey }

function store<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('reel-browser', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('device')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const req = run(open.result.transaction('device', mode).objectStore('device'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }
  })
}

const loadDevice = (): Promise<Device | undefined> => store('readonly', (s) => s.get('device') as IDBRequest<Device | undefined>)

/** Redeems a pairing code from the address bar, if there is one. false = the link was refused (used or expired). */
async function pairFromLink(): Promise<boolean> {
  const code = new URLSearchParams(location.hash.slice(1)).get('pair')
  if (!code) return true
  history.replaceState(null, '', location.pathname) // the code leaves the address bar and this history entry
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])) as CryptoKeyPair
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey)
  const r = await fetch('/api/pair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } })
  })
  if (!r.ok) return false
  const { device } = (await r.json()) as { device: string }
  await store('readwrite', (s) => s.put({ id: device, key: keys.privateKey } satisfies Device, 'device'))
  return true
}

async function sign(key: CryptoKey, challenge: string): Promise<string> {
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(challenge)))
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---- the connection -----------------------------------------------------------------------------------------------

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void }

export interface BrowserReel {
  api: ReelApi
  connection(): Connection
  /** Connection changes; `reconnected` is true when the socket came back after a drop (screens re-read their data). */
  onConnection(cb: (c: Connection, reconnected: boolean) => void): () => void
  /** This device's media token, for /media/<token>/<ref> URLs; '' until signed in. */
  mediaToken(): string
}

export function createBrowserReel(): BrowserReel {
  let ws: WebSocket | null = null
  let device: Device | undefined
  let token = ''
  let state: Connection = 'connecting'
  let everOpen = false
  let retry = 0
  let nextId = 1
  const pending = new Map<number, Pending>()
  const waiting = new Set<() => void>()
  const listeners = new Map<EventName, Set<(p: unknown) => void>>()
  const watchers = new Set<(c: Connection, reconnected: boolean) => void>()

  const set = (c: Connection, reconnected = false): void => {
    state = c
    for (const w of watchers) w(c, reconnected)
    if (c === 'open' || c === 'signed-out' || c === 'link-expired') for (const go of [...waiting]) go()
  }

  function connect(): void {
    ws = new WebSocket(`ws://${location.host}/ws`, [WS_PROTOCOL])
    ws.onmessage = (m) => {
      let msg: { id?: number; ok?: boolean; value?: unknown; error?: UserError; event?: EventName; payload?: unknown; challenge?: string; signedIn?: boolean; mediaToken?: string }
      try {
        msg = JSON.parse(String(m.data))
      } catch {
        return
      }
      if (msg.challenge) {
        const socket = ws
        void sign(device!.key, msg.challenge).then((signature) => socket?.send(JSON.stringify({ auth: { device: device!.id, signature } })))
        return
      }
      if (msg.signedIn) {
        token = msg.mediaToken ?? ''
        const back = everOpen
        everOpen = true
        retry = 0
        set('open', back)
        return
      }
      if (msg.event) {
        for (const cb of listeners.get(msg.event) ?? []) cb(msg.payload)
        return
      }
      const p = msg.id === undefined ? undefined : pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id!)
      if (msg.ok) p.resolve(msg.value)
      else p.reject(msg.error ?? OFFLINE)
    }
    ws.onclose = (e) => {
      ws = null
      for (const p of pending.values()) p.reject(OFFLINE)
      pending.clear()
      if (e.code === CLOSE_SIGNED_OUT) return set('signed-out')
      // gone or busy: try again, a little slower each time
      set(retry >= 3 ? 'stopped' : 'reconnecting')
      setTimeout(connect, [500, 1000, 2000, 5000][Math.min(retry++, 3)])
    }
  }

  async function start(): Promise<void> {
    const paired = await pairFromLink().catch(() => false)
    device = await loadDevice().catch(() => undefined)
    // a refused link with an older pairing still in place: that pairing signs in, and is all the page needs
    if (!device) return set(paired ? 'signed-out' : 'link-expired')
    connect()
  }

  function call(method: Method, args: unknown[]): Promise<unknown> {
    const send = (): Promise<unknown> => {
      if (state === 'signed-out' || state === 'link-expired') return Promise.reject(SIGNED_OUT)
      if (!ws || ws.readyState !== WebSocket.OPEN || state !== 'open') return Promise.reject(OFFLINE)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        ws!.send(JSON.stringify({ id, method, args }))
      })
    }
    if (state === 'open') return send()
    // the first connect, or a reconnect under way: wait a moment for it. A call that gives up is taken out of the
    // queue, so it can never be sent later behind the caller's back.
    return new Promise((resolve, reject) => {
      const go = () => {
        clearTimeout(t)
        waiting.delete(go)
        send().then(resolve, reject)
      }
      const t = setTimeout(() => {
        waiting.delete(go)
        reject(OFFLINE)
      }, 8000)
      waiting.add(go)
    })
  }

  const contract = createContractClient({
    call,
    on(event, cb) {
      const subs = listeners.get(event) ?? new Set()
      listeners.set(event, subs)
      subs.add(cb)
      return () => subs.delete(cb)
    }
  })

  const local =
    (what: string) =>
    (..._args: unknown[]): Promise<never> =>
      Promise.reject(localOnlyError(what))
  const off = () => () => {}

  const api: ReelApi = {
    host: 'browser',
    app: {
      ...contract.app,
      storage: local('Choosing where videos are kept'),
      finishFirstRun: local('Setting up'),
      openFolder: local('Showing files in Finder'),
      copyText: (t) => navigator.clipboard.writeText(t),
      // no path on this computer for a file picked in a browser: callers get '' and the call that needs the path says why
      pathForFile: () => '',
      chooseFolder: local('Choosing a folder'),
      setRoot: local('Choosing where videos are kept'),
      onCommand: off,
      startDrag: () => {}
    },
    model: { ...contract.model, download: local('Downloading the listening model'), cancel: local('Downloading the listening model') },
    ai: {
      ...contract.ai,
      setActive: local('Connecting an AI editor'),
      signInChatGPT: local('Connecting an AI editor'),
      cancelSignIn: local('Connecting an AI editor'),
      signOutChatGPT: local('Connecting an AI editor'),
      setClaudeKey: local('Connecting an AI editor'),
      openClaudeSignIn: local('Connecting an AI editor')
    },
    projects: {
      ...contract.projects,
      create: local('Adding a video'),
      resume: local('Picking up an unfinished video'),
      update: local('Editing it yourself'),
      rerender: local('Editing it yourself'),
      exportVersion: local('Exporting'),
      remove: local('Deleting a video')
    },
    notes: {
      attachFiles: local('Attaching pictures and clips'),
      attachData: local('Attaching pictures and clips'),
      attachClipboard: local('Attaching pictures and clips'),
      choose: local('Attaching pictures and clips'),
      remove: local('Attaching pictures and clips')
    },
    jobs: contract.jobs,
    phone: {
      start: local('Sending to your phone'),
      stop: async () => {},
      onEvent: off,
      emailSelf: local('Sending to your phone'),
      shareSheet: local('Sending to your phone')
    },
    library: { list: local('The Library'), add: local('Adding to the Library'), choose: local('Adding to the Library') },
    style: { ...contract.style, remove: local('Changing My style'), answer: local('Saving to My style') },
    script: { write: local('Help with a script') },
    dev: { renderTestAnimation: local('Test animations') },
    update: { ...contract.update, setEnabled: local('Changing update checks'), open: local('Updating Reel Studio'), dismiss: local('Updating Reel Studio') }
  }

  void start()
  return {
    api,
    connection: () => state,
    onConnection(cb) {
      watchers.add(cb)
      return () => watchers.delete(cb)
    },
    mediaToken: () => token
  }
}
