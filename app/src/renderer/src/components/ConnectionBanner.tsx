import { useEffect, useState } from 'react'
import type { BrowserReel, Connection } from '../browser-reel'

// In a browser only: what happened to the link to the computer, and what to do. Nothing while it works. The live
// region stays in the page so a screen reader hears each change.
const TEXT: Partial<Record<Connection, string>> = {
  reconnecting: 'Lost the link to Reel Studio on this computer. Reconnecting…',
  stopped: 'Reel Studio is not answering. Open it on this computer and this page reconnects by itself.',
  'signed-out': 'This browser is not signed in. In Reel Studio on this computer, choose File › Open in Browser.',
  'link-expired': 'That link has expired or was already used. In Reel Studio on this computer, choose File › Open in Browser for a new one.'
}

export function ConnectionBanner({ link }: { link: BrowserReel }) {
  const [c, setC] = useState<Connection>(link.connection())
  useEffect(() => link.onConnection((next) => setC(next)), [link])
  const text = TEXT[c] ?? ''
  return (
    <div className={`conn-banner${c === 'signed-out' || c === 'link-expired' ? ' error' : ''}`} role="status" aria-live="polite" data-testid="connection-banner">
      {text}
    </div>
  )
}
