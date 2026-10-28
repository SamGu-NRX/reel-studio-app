import type { Go, Screen } from '../nav'
import { ConnectAI, usingLine } from '../components/connect'
import { useNotify } from '../App'
import { Icon } from '../components/icons'
import { TitleBarSlot } from '../components/titlebar'

const BACK_LABEL: Record<Exclude<Screen, { name: 'connect' }>['name'], string> = {
  home: 'Reels',
  reel: 'Back to the reel',
  library: 'Library',
  style: 'My style',
  insights: 'Insights',
  settings: 'Settings'
}

/** Where every "Connect" button goes: the editor picker, nothing else. */
export function Connect({ back, go }: { back?: Exclude<Screen, { name: 'connect' }>; go: Go }) {
  const notify = useNotify()
  const leave = () => go(back ?? { name: 'home' })
  return (
    <div className="page" style={{ maxWidth: 560 }} data-testid="connect-screen">
      <TitleBarSlot title="Choose your editor" />
      <button className="back" onClick={leave} data-testid="connect-back">
        <Icon name="back" size={16} /> {BACK_LABEL[back?.name ?? 'home']}
      </button>
      <p className="muted" style={{ margin: '8px 0 12px' }}>
        Your editor makes each version and the changes in your notes, on your own plan.
      </p>
      <ConnectAI
        onConnected={(p) => {
          notify(usingLine(p))
          leave()
        }}
      />
    </div>
  )
}
