// Who may talk to the browser server (server/index.ts), decided per request. No electron import.
//
// Pairing registers a device: the browser makes an ECDSA P-256 key pair whose private half it cannot export
// (WebCrypto, kept in this origin's IndexedDB) and sends the public half with the one-time code from the link the
// desktop app opened. Every WebSocket then signs a fresh challenge with that key. Nothing that grants access is a
// cookie: cookies ignore ports, so a cookie for 127.0.0.1 would also reach every other local web server this browser
// visits, and any of them could replay it here. Video elements cannot sign, so each device also gets a media token,
// sent only over its signed-in socket and only ever put in this origin's URLs.
//
// Every request must come from the server's own origin as well: the Host check stops DNS rebinding (an attacker's
// hostname resolved to 127.0.0.1 still sends its own Host), the Origin check stops another site, or another localhost
// port, from opening the socket or pairing.
import { createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export const PAIRING_TTL_MS = 5 * 60_000
/** Browsers one launch will pair. Each pairing is a new device; the app forgets them all when it quits. */
export const MAX_DEVICES = 16

export interface Device {
  id: string
  key: KeyObject
  mediaToken: string
}

const b64 = (bytes: number): string => randomBytes(bytes).toString('base64url')

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** A P-256 public key in JWK form, or null. Anything else (RSA, a private key, garbage) is refused. */
function publicKeyOf(jwk: unknown): KeyObject | null {
  if (!jwk || typeof jwk !== 'object' || 'd' in jwk) return null
  const j = jwk as { kty?: unknown; crv?: unknown; x?: unknown; y?: unknown }
  if (j.kty !== 'EC' || j.crv !== 'P-256' || typeof j.x !== 'string' || typeof j.y !== 'string') return null
  try {
    return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: j.x, y: j.y }, format: 'jwk' })
  } catch {
    return null
  }
}

export function createAuth(port: number, now: () => number = Date.now) {
  const origin = `http://127.0.0.1:${port}`
  const host = `127.0.0.1:${port}`
  const codes = new Map<string, number>() // code -> expires at
  const devices = new Map<string, Device>()

  const header = (req: IncomingMessage, name: string): string | undefined => {
    const v = req.headers[name]
    return Array.isArray(v) ? undefined : v
  }

  return {
    origin,

    /** A new one-time code for a pairing link. Older unused codes stay valid until they expire. */
    newPairingCode(): string {
      for (const [c, exp] of codes) if (exp <= now()) codes.delete(c)
      const code = b64(24)
      codes.set(code, now() + PAIRING_TTL_MS)
      return code
    },

    /**
     * Spends a pairing code on a device key. Returns the new device's id, or null for an unknown, used or expired
     * code, a key that is not a P-256 public key, or a launch that already has MAX_DEVICES. A bad key does not spend
     * the code.
     */
    pair(code: unknown, jwk: unknown): string | null {
      if (typeof code !== 'string' || code.length > 64) return null
      const key = publicKeyOf(jwk)
      if (!key || devices.size >= MAX_DEVICES) return null
      let found: string | null = null
      for (const c of codes.keys()) if (same(c, code)) found = c
      if (!found) return null
      const exp = codes.get(found)!
      codes.delete(found)
      if (exp <= now()) return null
      const id = b64(16)
      devices.set(id, { id, key, mediaToken: b64(32) })
      return id
    },

    /** A fresh challenge for one socket. */
    challenge: (): string => b64(32),

    /**
     * The device that signed this socket's challenge (ECDSA P-256 / SHA-256, WebCrypto's raw r||s signature), or null.
     * The challenge is per socket, so a signature seen on one connection is useless on another.
     */
    verify(deviceId: unknown, challenge: string, signature: unknown): Device | null {
      if (typeof deviceId !== 'string' || typeof signature !== 'string' || signature.length > 200) return null
      const d = devices.get(deviceId)
      if (!d) return null
      try {
        const ok = verify('sha256', Buffer.from(challenge), { key: d.key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
        return ok ? d : null
      } catch {
        return null
      }
    },

    /** The device whose media token this is, or null. */
    mediaDevice(token: string): Device | null {
      let found: Device | null = null
      for (const d of devices.values()) if (same(d.mediaToken, token)) found = d
      return found
    },

    /** Host is exactly this server (DNS rebinding sends the attacker's hostname here). */
    hostOk(req: IncomingMessage): boolean {
      return header(req, 'host') === host
    },

    /** Origin is exactly this server. Required on the socket and on pairing. */
    originOk(req: IncomingMessage): boolean {
      return header(req, 'origin') === origin
    },

    /**
     * A GET says where it came from in Sec-Fetch-Site: another site or another localhost port may not load our page
     * or media. A client that sends none (not a browser, or an old one) still needs a media token for anything private.
     */
    fetchSiteOk(req: IncomingMessage): boolean {
      const site = header(req, 'sec-fetch-site')
      return site === undefined || site === 'same-origin' || site === 'none'
    }
  }
}

export type Auth = ReturnType<typeof createAuth>
