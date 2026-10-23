// The browser server: the contract (shared/contract.ts) for a browser on this computer, as T3 Code's `npx t3`
// serves its own UI. A WebSocket carries calls and events, plain HTTP carries video byte ranges. It runs inside the
// desktop app for now and listens on 127.0.0.1 only. auth.ts decides who may use it. No electron import.
//
//   GET  / and /assets/*          the renderer build (out/renderer), the same files the desktop window loads. Public:
//                                 it holds no data, and it is where a pairing link (/#pair=<code>) lands
//   POST /api/pair                {code, key: P-256 public JWK} -> {device}
//   GET  /ws                      WebSocket, subprotocol reel-contract.<CONTRACT_VERSION>. The server sends
//                                 {challenge}; the page answers {auth: {device, signature}}; then calls and events
//   GET  /media/<token>/<ref>     a MediaRef with the device's media token, Range support, HEAD too
import { closeSync, createReadStream, readFileSync, realpathSync, statSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { pipeline } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { WS_PROTOCOL, type EventName } from '../../shared/contract'
import { openMediaRef, parseRange } from '../media-files'
import type { Service } from '../service'
import { createAuth, type Auth, type Device } from './auth'

export { WS_PROTOCOL }

/** Socket close code for "not signed in"; the page stops reconnecting and asks for a new link. */
export const CLOSE_SIGNED_OUT = 4401

/** Limits on what a client may send or leave waiting. There is no upload route yet (phone uploads are a later gate,
 * see notes/design/browser-proto-next.md), so every request body is small. */
export const LIMITS = {
  /** POST /api/pair body */
  pairBody: 1024,
  /** one WebSocket message (a call); ws closes the socket with 1009 above it */
  wsMessage: 64 * 1024,
  /** calls one socket may have running at once */
  inFlight: 16,
  /** open sockets, signed in or not */
  sockets: 16,
  /** time a new socket has to answer its challenge */
  authMs: 5_000,
  /** bytes queued to one socket before it is dropped as too slow (a stuck tab must not hold memory) */
  wsBuffered: 4 * 1024 * 1024,
  /** TCP connections at once, including ones still sending headers */
  connections: 64
}

export interface BrowserServerOptions {
  /** 0 = any free port */
  port?: number
  service: Pick<Service, 'dispatch'>
  /** The renderer build to serve (index.html + assets/). null = the API only. */
  rendererDir: string | null
  log(line: string): void
}

export interface BrowserServer {
  readonly port: number
  readonly auth: Auth
  /** A fresh one-time link that pairs a browser. */
  pairingUrl(): string
  /** Sends a contract event to every signed-in browser. */
  publish(event: EventName, payload: unknown): void
  /** Closes every open socket without forgetting any device; browsers reconnect by themselves. */
  dropSockets(): void
  close(): Promise<void>
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
}

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
}

function send(res: ServerResponse, status: number, body: string | Buffer = '', headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

/** The request body, up to `limit` bytes, counted as it arrives (chunked bodies too). null = too big (413). */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > limit) return resolve(null)
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        req.removeAllListeners('data')
        req.resume()
        resolve(null)
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** What a failed call tells the page: a UserError's code and message, never an internal error text. */
function errorBody(e: unknown): { code: string; userMessage: string } {
  if (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' && typeof (e as { userMessage?: unknown }).userMessage === 'string') {
    const u = e as { code: string; userMessage: string }
    return { code: u.code, userMessage: u.userMessage }
  }
  return { code: 'UNEXPECTED', userMessage: 'Something went wrong. Please try again.' }
}

function rejectUpgrade(socket: Socket, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

export async function startBrowserServer(o: BrowserServerOptions): Promise<BrowserServer> {
  const http = createServer()
  http.requestTimeout = 60_000
  http.headersTimeout = 10_000
  http.maxConnections = LIMITS.connections
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(o.port ?? 0, '127.0.0.1', () => resolve())
  })
  const port = (http.address() as AddressInfo).port
  const auth = createAuth(port)
  // The page's own policy, stricter than the build's meta tag (which also allows the desktop's reel-media:).
  const appCsp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self'",
    `connect-src 'self' ws://127.0.0.1:${port}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.wsMessage,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false)
  })
  const signedIn = new Set<WebSocket>()

  http.on('request', (req, res) => {
    void route(req, res).catch((e) => {
      o.log(`[browser] ${req.method} ${pathOf(req)} failed: ${String(e)}`)
      if (!res.headersSent) send(res, 500, 'Something went wrong.')
      else res.destroy()
    })
  })

  // Never log a query string: cache busters live there. Media paths are logged only up to /media/.
  const pathOf = (req: IncomingMessage): string => {
    const p = (req.url ?? '').split('?')[0]
    return p.startsWith('/media/') ? '/media/…' : p
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!auth.hostOk(req)) return send(res, 403, 'Wrong host.')
    const path = (req.url ?? '').split('?')[0]
    const method = req.method ?? 'GET'

    if (path === '/api/pair') {
      if (method !== 'POST') return send(res, 405, '', { Allow: 'POST' })
      if (!auth.originOk(req)) return send(res, 403, 'Wrong origin.')
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, 'Send JSON.')
      const body = await readBody(req, LIMITS.pairBody)
      if (!body) return send(res, 413, 'Too large.')
      let msg: { code?: unknown; key?: unknown }
      try {
        msg = JSON.parse(body.toString('utf8')) ?? {}
      } catch {
        return send(res, 400, 'Bad request.')
      }
      const device = auth.pair(msg.code, msg.key)
      if (!device) {
        o.log('[browser] a pairing was refused')
        return send(res, 403, 'This link has expired or was already used.')
      }
      o.log('[browser] a browser paired')
      return send(res, 200, JSON.stringify({ device }), { 'Content-Type': 'application/json' })
    }

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, '', { Allow: 'GET, HEAD' })
    if (!auth.fetchSiteOk(req)) return send(res, 403, 'Not from this page.')

    if (path.startsWith('/media/')) {
      const [token, ...rest] = path.slice('/media/'.length).split('/')
      if (!auth.mediaDevice(token)) return send(res, 401, 'Not signed in.')
      return serveMedia(req, res, rest.join('/'))
    }
    if (o.rendererDir && path === '/') return serveApp(res, 'index.html')
    if (o.rendererDir && /^\/assets\/[\w.-]+$/.test(path)) return serveApp(res, path.slice(1))
    return send(res, 404, 'Not found.')
  }

  /** A file of the renderer build. Names are vite's own (hashed, no subfolders); the real path must stay inside. */
  function serveApp(res: ServerResponse, rel: string): void {
    const type = rel === 'index.html' ? 'text/html; charset=utf-8' : ASSET_TYPES[extname(rel)]
    if (!type) return send(res, 404, 'Not found.')
    let file: string
    let dir: string
    try {
      dir = realpathSync.native(o.rendererDir!)
      file = realpathSync.native(join(dir, rel))
    } catch {
      return send(res, 404, 'Not found.')
    }
    if (!file.startsWith(dir + sep) || !statSync(file).isFile()) return send(res, 404, 'Not found.')
    if (rel === 'index.html') return send(res, 200, readFileSync(file), { 'Content-Type': type, 'Content-Security-Policy': appCsp })
    // hashed names: a new build has new names, so a long cache is safe
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' })
    pipeline(createReadStream(file), res, () => undefined)
  }

  function serveMedia(req: IncomingMessage, res: ServerResponse, ref: string): void {
    const media = openMediaRef(ref)
    if (!media.ok) return send(res, media.status)
    const { fd, type, size } = media
    // A media element sends no If-Range validator we could check, and refs change when the file does (?v=).
    const headers: Record<string, string> = { ...SECURITY_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' }
    const range = parseRange(req.headers.range, size)
    if (range === 'unsatisfiable') {
      closeSync(fd)
      return send(res, 416, '', { 'Content-Range': `bytes */${size}` })
    }
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD' || size === 0) {
      closeSync(fd)
      return void res.end()
    }
    // The descriptor openMediaRef checked, never the path again. pipeline closes it when the browser goes away
    // mid-video (a seek aborts the old request).
    pipeline(createReadStream('', { fd, start, end }), res, () => undefined)
  }

  http.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    socket.on('error', () => undefined)
    if (!auth.hostOk(req)) return rejectUpgrade(socket, 403, 'Forbidden')
    if ((req.url ?? '').split('?')[0] !== '/ws') return rejectUpgrade(socket, 404, 'Not Found')
    if (!auth.originOk(req)) return rejectUpgrade(socket, 403, 'Forbidden')
    const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim())
    if (!offered.includes(WS_PROTOCOL)) return rejectUpgrade(socket, 426, 'Upgrade Required')
    if (wss.clients.size >= LIMITS.sockets) return rejectUpgrade(socket, 503, 'Service Unavailable')
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws))
  })

  /** Sends one message, or drops a socket that has stopped reading (it reconnects and reads a fresh snapshot). */
  function sendTo(ws: WebSocket, msg: unknown): void {
    if (ws.readyState !== ws.OPEN) return
    if (ws.bufferedAmount > LIMITS.wsBuffered) return void ws.terminate()
    ws.send(JSON.stringify(msg))
  }

  function onSocket(ws: WebSocket): void {
    let device: Device | null = null
    let inFlight = 0
    const challenge = auth.challenge()
    const late = setTimeout(() => !device && ws.close(CLOSE_SIGNED_OUT, 'Sign in first'), LIMITS.authMs)
    ws.on('error', () => undefined)
    ws.on('close', () => {
      clearTimeout(late)
      signedIn.delete(ws)
    })
    sendTo(ws, { challenge })
    ws.on('message', (data, isBinary) => {
      let msg: { id?: unknown; method?: unknown; args?: unknown; auth?: { device?: unknown; signature?: unknown } }
      try {
        if (isBinary) throw new Error('binary')
        msg = JSON.parse(data.toString())
      } catch {
        return ws.close(1003, 'JSON text only')
      }
      if (!device) {
        device = auth.verify(msg?.auth?.device, challenge, msg?.auth?.signature)
        if (!device) return ws.close(CLOSE_SIGNED_OUT, 'Not signed in')
        clearTimeout(late)
        signedIn.add(ws)
        return sendTo(ws, { signedIn: true, mediaToken: device.mediaToken })
      }
      const id = msg?.id
      if (!(typeof id === 'number' && Number.isSafeInteger(id))) return ws.close(1008, 'Each call needs a numeric id')
      if (inFlight >= LIMITS.inFlight) return sendTo(ws, { id, ok: false, error: { code: 'BUSY', userMessage: 'Too many requests at once. Try again in a moment.' } })
      inFlight++
      o.service
        .dispatch(msg.method, msg.args, { browser: true })
        .then(
          (value) => sendTo(ws, { id, ok: true, value }),
          (e) => {
            const err = errorBody(e)
            if (err.code === 'UNEXPECTED' || err.code === 'BAD_REQUEST') o.log(`[browser] call ${String(msg.method).slice(0, 40)} failed: ${err.code} ${String((e as Error)?.message ?? (e as { detail?: string })?.detail ?? '')}`)
            sendTo(ws, { id, ok: false, error: err })
          }
        )
        .finally(() => inFlight--)
    })
  }

  return {
    port,
    auth,
    pairingUrl: () => `${auth.origin}/#pair=${auth.newPairingCode()}`,
    publish(event, payload) {
      for (const ws of signedIn) sendTo(ws, { event, payload })
    },
    dropSockets() {
      for (const ws of wss.clients) ws.terminate()
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of wss.clients) ws.terminate()
        wss.close()
        http.close(() => resolve())
        http.closeAllConnections()
      })
  }
}
