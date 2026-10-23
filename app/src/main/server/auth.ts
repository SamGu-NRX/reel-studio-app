// Who may talk to the browser server (server/index.ts), decided per request. No electron import.
//
// One session token per launch, random, held by the browser only as an HttpOnly cookie. The browser gets it by
// redeeming a one-time pairing code that the desktop app put in the link it opened. Every request must also come
// from the server's own origin: the Host check stops DNS rebinding (an attacker's hostname resolved to 127.0.0.1
// still sends its own Host), the Origin check stops another site, or another localhost port, from driving the
// API with the browser's cookie (SameSite treats every port of 127.0.0.1 as the same site, so it cannot).
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export const PAIRING_TTL_MS = 5 * 60_000

const b64 = (bytes: number): string => randomBytes(bytes).toString('base64url')

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function createAuth(port: number, now: () => number = Date.now) {
  const origin = `http://127.0.0.1:${port}`
  const host = `127.0.0.1:${port}`
  const cookieName = `reel_session_${port}`
  const session = b64(32)
  const codes = new Map<string, number>() // code -> expires at

  const header = (req: IncomingMessage, name: string): string | undefined => {
    const v = req.headers[name]
    return Array.isArray(v) ? undefined : v
  }

  return {
    origin,
    cookieName,

    /** A new one-time code for a pairing link. Older unused codes stay valid until they expire. */
    newPairingCode(): string {
      for (const [c, exp] of codes) if (exp <= now()) codes.delete(c)
      const code = b64(24)
      codes.set(code, now() + PAIRING_TTL_MS)
      return code
    },

    /** Spends a pairing code. Returns the cookie to set, or null for an unknown, used or expired code. */
    redeem(code: unknown): string | null {
      if (typeof code !== 'string' || code.length > 64) return null
      let found: string | null = null
      for (const c of codes.keys()) if (same(c, code)) found = c
      if (!found) return null
      const exp = codes.get(found)!
      codes.delete(found)
      if (exp <= now()) return null
      return `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`
    },

    /** Host is exactly this server (DNS rebinding sends the attacker's hostname here). */
    hostOk(req: IncomingMessage): boolean {
      return header(req, 'host') === host
    },

    /** Origin is exactly this server. Required on anything that is not a plain GET/HEAD. */
    originOk(req: IncomingMessage): boolean {
      return header(req, 'origin') === origin
    },

    /**
     * A GET for media or the app's files: the browser says where it came from in Sec-Fetch-Site. Another origin
     * (including another localhost port) may not embed our videos with the user's cookie. A client that sends no
     * Sec-Fetch-Site (not a browser, or an old one) still needs the cookie.
     */
    fetchSiteOk(req: IncomingMessage): boolean {
      const site = header(req, 'sec-fetch-site')
      return site === undefined || site === 'same-origin' || site === 'none'
    },

    /** The request carries this launch's session cookie. */
    signedIn(req: IncomingMessage): boolean {
      const raw = header(req, 'cookie')
      if (!raw) return false
      for (const part of raw.split(';')) {
        const i = part.indexOf('=')
        if (i < 0) continue
        if (part.slice(0, i).trim() === cookieName && same(part.slice(i + 1).trim(), session)) return true
      }
      return false
    }
  }
}

export type Auth = ReturnType<typeof createAuth>
