import { useEffect, useState } from 'react'
import type { AppInfo, ProviderInfo } from '../../../shared/api'
import { reel } from '../api'

/** Settings in a browser: what is set on the computer, read-only, and what this browser can and cannot do. */
export function BrowserSettings({ info }: { info: AppInfo }) {
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  useEffect(() => {
    reel.ai.active().then(setProvider).catch(() => {})
  }, [])
  const aiOn = !!provider && provider.connected && provider.id !== 'none'
  return (
    <div className="page narrow" data-testid="browser-settings">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <section className="panel">
        <h2>Your AI editor</h2>
        <p className="muted">{provider ? (aiOn ? provider.label : 'None connected yet.') : ' '}</p>
      </section>
      <section className="panel">
        <h2>In this browser</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          You can open your reels, play every version, and send notes to your editor while you watch their progress. Your
          videos stay on the computer running Reel Studio.
        </p>
        <p className="muted" style={{ marginTop: 10 }}>
          Adding videos, editing by hand, exporting, the Library and these settings work in the Reel Studio app on that
          computer. So do notifications: keep this tab open to see when a version is ready.
        </p>
      </section>
      <section className="panel">
        <h2>About</h2>
        <p className="muted" style={{ marginTop: 6 }}>Reel Studio {info.version}.</p>
      </section>
    </div>
  )
}
