// Every setting, once: its section, the label Settings shows, and the other words people search for it by.
// Settings draws each row's label from here, so what search finds is always what the row says.

export const SECTIONS = {
  editor: 'Editor',
  posting: 'Posting',
  storage: 'Storage and listening',
  notifications: 'Notifications',
  privacy: 'Privacy',
  about: 'About and updates'
} as const

export type SectionId = keyof typeof SECTIONS

const MODEL_WORDS = ['model', 'models', 'Fable', 'Opus', 'Sonnet', 'Auto']
const SHARING_WORDS = ['telemetry', 'analytics', 'data sharing']

export const SETTINGS = {
  editor: { section: 'editor', label: 'Choose your editor', synonyms: ['AI', 'AI editor', 'Claude', 'Claude Code', 'ChatGPT', 'OpenAI', 'GPT', 'provider', 'connect', 'sign in', 'log in', 'sign out', 'disconnect', 'account', 'plan', 'subscription'] },
  'check-edits': { section: 'editor', label: 'Double-check each edit', synonyms: ['check', 'checker', 'double check', 'review', 'second look', 'verify', 'fix', 'mistakes'] },
  'model-edits': { section: 'editor', label: 'Edits', synonyms: [...MODEL_WORDS, 'editor model', 'makes the edits'] },
  'model-checks': { section: 'editor', label: 'Checks each edit', synonyms: [...MODEL_WORDS, 'checker', 'review', 'second opinion', 'verify'] },
  'model-titles': { section: 'editor', label: 'Writes titles', synonyms: [...MODEL_WORDS, 'writer', 'titles', 'summaries', 'small model', 'fast model'] },
  'own-server': { section: 'editor', label: 'Your own AI server', synonyms: ['server', 'local', 'self-hosted', 'Ollama', 'LM Studio', 'OpenAI-compatible', 'Anthropic-compatible', 'endpoint', 'base URL', 'proxy', 'custom', 'advanced'] },
  'api-key': { section: 'editor', label: 'Anthropic API key', synonyms: ['key', 'API', 'token', 'console', 'billing', 'pay as you go', 'advanced'] },
  instagram: { section: 'posting', label: 'Instagram', synonyms: ['post', 'posting', 'publish', 'upload', 'social', 'platforms', 'TikTok', 'YouTube', 'Shorts'] },
  'library-folder': { section: 'storage', label: 'Library folder', synonyms: ['folder', 'location', 'where', 'storage', 'save', 'saved', 'path', 'directory', 'Movies', 'Documents', 'Finder', 'Explorer', 'disk', 'files', 'move'] },
  'listening-model': { section: 'storage', label: 'Listening model', synonyms: ['subtitles', 'captions', 'transcript', 'transcription', 'speech', 'speech to text', 'Whisper', 'WhisperX', 'words', 'voice', 'download', 'offline'] },
  'faster-exports': { section: 'storage', label: 'Faster versions', synonyms: ['30 fps', '30fps', '60 fps', 'fps', 'frame rate', 'export quality', 'quality', 'smooth', 'speed', 'render', 'export'] },
  notifications: { section: 'notifications', label: 'Notify when a reel is ready', synonyms: ['notifications', 'alerts', 'notify', 'banner', 'finished', 'done'] },
  sharing: { section: 'privacy', label: 'Share anonymous data to help improve Reel Studio', synonyms: [...SHARING_WORDS, 'tracking', 'diagnostics', 'usage data', 'opt out', 'opt in', 'statistics', 'stats', 'privacy'] },
  'sharing-usage': { section: 'privacy', label: 'Usage', needs: 'sharing', synonyms: [...SHARING_WORDS, 'features', 'errors', 'crashes'] },
  'sharing-quality': { section: 'privacy', label: 'Quality scores', needs: 'sharing', synonyms: [...SHARING_WORDS, 'edit quality', 'scores', 'kept', 'undone'] },
  'sharing-posts': { section: 'privacy', label: 'Post results', needs: 'sharing', synonyms: [...SHARING_WORDS, 'views', 'view counts', 'results'] },
  version: { section: 'about', label: 'Version', synonyms: ['about', 'version number', 'build', 'release'] },
  licence: { section: 'about', label: 'Licence and notices', synonyms: ['license', 'MIT', 'open source', 'notices', 'third party', 'credits', 'copyright'] },
  updates: { section: 'about', label: 'Check for updates', synonyms: ['update', 'updates', 'upgrade', 'new version', 'automatic updates', 'download', 'install', 'restart', 'releases'] },
  'whats-new': { section: 'about', label: 'What’s new', synonyms: ['whats new', 'changelog', 'release notes', 'changes', 'new features'] }
} as const satisfies Record<string, { section: SectionId; label: string; synonyms: readonly string[]; needs?: string }>

export type SettingId = keyof typeof SETTINGS

export const SETTING_IDS = Object.keys(SETTINGS) as SettingId[]

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const HAYSTACK = new Map(SETTING_IDS.map((id) => [id, words([SETTINGS[id].label, SECTIONS[SETTINGS[id].section], ...SETTINGS[id].synonyms].join(' '))]))

/**
 * The settings a search shows: every word typed starts a word of the label, the section's name or a synonym, plus
 * the switch a found setting `needs` to be usable (Usage is greyed out until sharing is on). null: no search.
 */
export function findSettings(query: string): Set<SettingId> | null {
  const typed = words(query)
  if (!typed.length) return null
  const found = SETTING_IDS.filter((id) => typed.every((w) => HAYSTACK.get(id)!.some((h) => h.startsWith(w))))
  return new Set(found.flatMap((id) => ('needs' in SETTINGS[id] ? [SETTINGS[id].needs as SettingId, id] : [id])))
}
