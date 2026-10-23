// The browser server: the contract (shared/contract.ts) for a browser on this computer, as T3 Code's `npx t3`
// serves its own UI. A WebSocket carries calls and events, plain HTTP carries video byte ranges. It runs inside the
// desktop app for now and listens on 127.0.0.1 only. auth.ts decides who may use it. No electron import.
//
//   GET  /pair#code=...   the pairing page; its script POSTs the code, which never reaches a log or a Referer
//   POST /api/pair        {code} -> the session cookie
//   GET  /ws              WebSocket, subprotocol reel-contract.<CONTRACT_VERSION>
//   GET  /media/<ref>     a MediaRef, with Range support (HEAD too)
import { createReadStream } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { pipeline } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { CONTRACT_VERSION, type EventName } from '../../shared/contract'
import { parseRange, resolveMediaRef } from '../media-files'
import type { Service } from '../service'
import { createAuth, type Auth } from './auth'
import { PAIR_HTML, PAIR_JS } from './pair-page'

export const WS_PROTOCOL = `reel-contract.${CONTRACT_VERSION}`

/** Limits on what a client may send. There is no upload route yet (phone uploads are a later gate, see
 * notes/design/browser-proto-next.md), so every request body is small. */
export const LIMITS = {
  /** POST /api/pair body */
  pairBody: 1024,
  /** one WebSocket message (a call); ws closes the socket with 1009 above it */
  wsMessage: 64 * 1024,
  /** calls one socket may have running at once */
  inFlight: 16,
  /** open sockets */
  sockets: 16,
  /** bytes queued to one socket before it is dropped as too slow (a stuck tab must not hold events in memory) */
  wsBuffered: 4 * 1024 * 1024
}

export interface BrowserServerOptions {
  /** 0 = any free port */
  port?: number
  service: Pick<Service, 'dispatch'>
  log(line: string): void
}

export interface BrowserServer {
  readonly port: number
  readonly auth: Auth
  /** A fresh one-time link that signs a browser in. */
  pairingUrl(): string
  /** Sends a contract event to every signed-in browser. */
  publish(event: EventName, payload: unknown): void
  close(): Promise<void>
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY'
}

function send(res: ServerResponse, status: number, body = '', headers: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', ...headers })
  res.end(body)
}

/** The request body, up to `limit` bytes. null = too big (the caller answers 413). */
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
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(o.port ?? 0, '127.0.0.1', () => resolve())
  })
  const port = (http.address() as AddressInfo).port
  const auth = createAuth(port)
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: LIMITS.wsMessage,
    handleProtocols: (protocols) => (protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false)
  })

  http.on('request', (req, res) => {
    void route(req, res).catch((e) => {
      o.log(`[browser] ${req.method} ${pathOf(req)} failed: ${String(e)}`)
      if (!res.headersSent) send(res, 500, 'Something went wrong.')
      else res.destroy()
    })
  })

  // Never log a query string or fragment: pairing codes and cache busters live there.
  const pathOf = (req: IncomingMessage): string => (req.url ?? '').split('?')[0]

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!auth.hostOk(req)) return send(res, 403, 'Wrong host.')
    const path = pathOf(req)
    const method = req.method ?? 'GET'

    if (path === '/api/pair') {
      if (method !== 'POST') return send(res, 405, '', { Allow: 'POST' })
      if (!auth.originOk(req)) return send(res, 403, 'Wrong origin.')
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, 'Send JSON.')
      const body = await readBody(req, LIMITS.pairBody)
      if (!body) return send(res, 413, 'Too large.')
      let code: unknown
      try {
        code = (JSON.parse(body.toString('utf8')) as { code?: unknown })?.code
      } catch {
        return send(res, 400, 'Bad request.')
      }
      const cookie = auth.redeem(code)
      if (!cookie) {
        o.log('[browser] a pairing code was refused')
        return send(res, 403, 'This link has expired or was already used.')
      }
      o.log('[browser] a browser signed in')
      return send(res, 204, '', { 'Set-Cookie': cookie })
    }

    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, '', { Allow: 'GET, HEAD' })

    if (path === '/pair') return send(res, 200, PAIR_HTML, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAIR_CSP })
    if (path === '/pair.js') return send(res, 200, PAIR_JS, { 'Content-Type': 'text/javascript; charset=utf-8' })

    if (!auth.fetchSiteOk(req)) return send(res, 403, 'Not from this page.')
    if (!auth.signedIn(req)) return send(res, 401, 'Open Reel Studio on this computer and choose File > Open in Browser.')

    if (path.startsWith('/media/')) return serveMedia(req, res, path.slice('/media/'.length))
    return send(res, 404, 'Not found.')
  }

  function serveMedia(req: IncomingMessage, res: ServerResponse, ref: string): void {
    const media = resolveMediaRef(ref)
    if (!media.ok) return send(res, media.status)
    const { file, type, size } = media
    // A media element sends no If-Range validator we could check, and refs change when the file does (?v=).
    const headers: Record<string, string> = { ...SECURITY_HEADERS, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' }
    const range = parseRange(req.headers.range, size)
    if (range === 'unsatisfiable') return send(res, 416, '', { 'Content-Range': `bytes */${size}` })
    const start = range ? range.start : 0
    const end = range ? range.end : size - 1
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD' || size === 0) return void res.end()
    // pipeline destroys the file stream when the browser goes away mid-video (a seek aborts the old request)
    pipeline(createReadStream(file, { start, end }), res, () => undefined)
  }

  http.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    socket.on('error', () => undefined)
    if (!auth.hostOk(req)) return rejectUpgrade(socket, 403, 'Forbidden')
    if ((req.url ?? '').split('?')[0] !== '/ws') return rejectUpgrade(socket, 404, 'Not Found')
    if (!auth.originOk(req)) return rejectUpgrade(socket, 403, 'Forbidden')
    if (!auth.signedIn(req)) return rejectUpgrade(socket, 401, 'Unauthorized')
    const offered = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map((s) => s.trim())
    if (!offered.includes(WS_PROTOCOL)) return rejectUpgrade(socket, 426, 'Upgrade Required')
    if (wss.clients.size >= LIMITS.sockets) return rejectUpgrade(socket, 503, 'Service Unavailable')
    wss.handleUpgrade(req, socket, head, (ws) => onSocket(ws))
  })

  function onSocket(ws: WebSocket): void {
    let inFlight = 0
    const reply = (msg: unknown): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }
    ws.on('error', () => undefined)
    ws.on('message', (data, isBinary) => {
      let call: { id?: unknown; method?: unknown; args?: unknown }
      try {
        if (isBinary) throw new Error('binary')
        call = JSON.parse(data.toString())
      } catch {
        return ws.close(1003, 'JSON text only')
      }
      const id = call?.id
      if (!(typeof id === 'number' && Number.isSafeInteger(id))) return ws.close(1008, 'Each call needs a numeric id')
      if (inFlight >= LIMITS.inFlight) return reply({ id, ok: false, error: { code: 'BUSY', userMessage: 'Too many requests at once. Try again in a moment.' } })
      inFlight++
      o.service
        .dispatch(call.method, call.args)
        .then(
          (value) => reply({ id, ok: true, value }),
          (e) => {
            const err = errorBody(e)
            if (err.code === 'UNEXPECTED' || err.code === 'BAD_REQUEST') o.log(`[browser] call ${String(call.method).slice(0, 40)} failed: ${err.code} ${String((e as Error)?.message ?? (e as { detail?: string })?.detail ?? '')}`)
            reply({ id, ok: false, error: err })
          }
        )
        .finally(() => inFlight--)
    })
  }

  return {
    port,
    auth,
    pairingUrl: () => `${auth.origin}/pair#code=${auth.newPairingCode()}`,
    publish(event, payload) {
      const msg = JSON.stringify({ event, payload })
      for (const ws of wss.clients) {
        if (ws.readyState !== ws.OPEN) continue
        // A tab that stopped reading (asleep, stuck) is dropped rather than buffered without end; it reconnects
        // and reads a fresh snapshot.
        if (ws.bufferedAmount > LIMITS.wsBuffered) ws.terminate()
        else ws.send(msg)
      }
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

const PAIR_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
