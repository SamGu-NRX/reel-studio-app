import { useState } from 'react'
import { BrandMark } from './brand'
import { Button } from './ui'

/**
 * Library › Videos in the demo build: where the club's footage comes from. ScorePlay and Twelve Labs are shown
 * connected (the hackathon's sources, read by the server); the rest say they come in the full release.
 */
export function Sources() {
  const [asked, setAsked] = useState<string | null>(null)
  const later = [
    { id: 'gdrive', name: 'Google Drive', mark: <BrandMark name="gdrive" size={16} /> },
    { id: 'dropbox', name: 'Dropbox', mark: <span className="src-mono">Db</span> },
    { id: 'frameio', name: 'Frame.io', mark: <span className="src-mono">F</span> }
  ]
  return (
    <section className="src" aria-label="Video sources" data-testid="sources">
      <div className="src-tile on" data-testid="source-scoreplay">
        <span className="src-mark">
          <span className="src-mono dark">SP</span>
        </span>
        <span className="src-t">
          <b>Tottenham Hotspur · ScorePlay</b>
          <span>Manchester United vs Spurs · Premier League week 6</span>
          <span className="src-meta">
            <span className="src-ok">Connected</span> · 57 club videos · 1 full match
          </span>
        </span>
      </div>
      <div className="src-tile on" data-testid="source-twelvelabs">
        <span className="src-mark">
          <span className="src-mono dark">12</span>
        </span>
        <span className="src-t">
          <b>Twelve Labs</b>
          <span>Index: Man United v Spurs, full match</span>
          <span className="src-meta">
            <span className="src-ok">Connected</span> · searchable by moment
          </span>
        </span>
      </div>
      {later.map((s) => (
        <div key={s.id} className="src-tile" data-testid={`source-${s.id}`}>
          <span className="src-mark">{s.mark}</span>
          <span className="src-t">
            <b>{s.name}</b>
            {asked === s.id ? (
              <span className="src-later" role="status">
                Available in the full release
              </span>
            ) : (
              <Button size="small" className="src-connect" onClick={() => setAsked(s.id)}>
                Connect
              </Button>
            )}
          </span>
        </div>
      ))}
    </section>
  )
}
