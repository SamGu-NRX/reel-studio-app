export type Screen =
  | { name: 'home' }
  /** `files`: opened with Reel Studio, waiting for Make my reel */
  | { name: 'new'; files?: string[] }
  | { name: 'script' }
  | { name: 'working'; slug: string }
  | { name: 'reel'; slug: string; fresh?: boolean }
  | { name: 'library' }
  | { name: 'style' }
  | { name: 'insights' }
  | { name: 'settings'; section?: SettingsSection }
  | { name: 'connect'; back?: Exclude<Screen, { name: 'connect' }> }

export type Go = (s: Screen) => void

export type SettingsSection = 'ai' | 'listen' | 'where' | 'notify' | 'privacy' | 'about'
