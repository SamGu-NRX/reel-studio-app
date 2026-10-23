export type Screen =
  | { name: 'home' }
  | { name: 'reel'; slug: string }
  | { name: 'library' }
  | { name: 'style' }
  | { name: 'insights' }
  | { name: 'settings'; section?: SettingsSection }
  | { name: 'connect'; back?: Exclude<Screen, { name: 'connect' }> }

export type Go = (s: Screen) => void

export type SettingsSection = 'ai' | 'listen' | 'where' | 'notify' | 'privacy' | 'about'
