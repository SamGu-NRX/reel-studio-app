// The reel-media: protocol of the desktop window: reel-media://f/<MediaRef>. Streams files with HTTP range support
// so <video> can seek. Which files it may serve is media-files.ts's decision, shared with the browser server.
import { protocol } from 'electron'
import { closeSync, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME } from '../shared/media-ref'
import { openMediaRef, parseRange } from './media-files'

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const u = new URL(req.url)
    const media = openMediaRef(u.pathname.replace(/^\//, ''))
    if (!media.ok) return new Response(null, { status: media.status })
    const { fd, type, size } = media
    const range = parseRange(req.headers.get('range'), size)
    if (range === 'unsatisfiable' || size === 0) {
      closeSync(fd)
      return range === 'unsatisfiable' ? new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }) : new Response(null, { status: 200, headers: { 'Content-Type': type, 'Content-Length': '0' } })
    }
    // the descriptor openMediaRef checked, never the path again
    if (range) {
      const body = Readable.toWeb(createReadStream('', { fd, start: range.start, end: range.end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    const body = Readable.toWeb(createReadStream('', { fd })) as ReadableStream
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' }
    })
  })
}
