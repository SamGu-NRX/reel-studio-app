// Plain words for a plan or account at its limit: who hit it and when it is free again. Never "you're at your limit"
// on its own.

/** "at 4:10 PM (in 1 h 2 min)", "tomorrow at 9:00 AM (in 14 h)", "Thu at 9:00 AM": in this computer's time zone. */
export function resetWords(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const ms = at.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 60_000) return 'in a minute';
  const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  const when = days === 0 ? `at ${clock}` : days === 1 ? `tomorrow at ${clock}` : `${at.toLocaleDateString('en-US', { weekday: 'short' })} at ${clock}`;
  return days < 2 ? `${when} (in ${duration(ms)})` : when;
}

/** "42 min", "2 h 14 min", "3 d 4 h". */
export function duration(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const PROVIDER_NAME: Record<string, string> = { claude: 'Claude', anthropic: 'Claude', codex: 'ChatGPT', openai: 'ChatGPT', gemini: 'Gemini', 'gemini-cli': 'Gemini', antigravity: 'Gemini', xai: 'Grok', grok: 'Grok' };
export const providerName = (p: string | undefined): string | undefined => (p ? PROVIDER_NAME[p.toLowerCase()] ?? p : undefined);

export interface ServerLimit {
  provider?: string;
  model?: string;
  resetsAt?: string;
}

/**
 * The limit in a 429 from the person's own server, when it says one. CLIProxyAPI answers `error.code: model_cooldown`
 * with `reset_seconds`, `provider` and `model` once every account for a model is resting (sdk/cliproxy/auth/selector.go);
 * a ChatGPT answer it passes on carries `resets_in_seconds` or `resets_at`.
 */
export function serverLimit(body: unknown, now: number = Date.now()): ServerLimit | null {
  const e = (body as any)?.error ?? body;
  if (!e || typeof e !== 'object') return null;
  const secs = [e.reset_seconds, e.resets_in_seconds].find((v) => typeof v === 'number' && v >= 0);
  const at = typeof e.resets_at === 'number' ? new Date(e.resets_at * 1000).toISOString() : typeof e.resets_at === 'string' && Number.isFinite(Date.parse(e.resets_at)) ? new Date(e.resets_at).toISOString() : undefined;
  const limited = e.code === 'model_cooldown' || e.type === 'usage_limit_reached' || e.code === 'usage_limit_reached' || secs !== undefined || at !== undefined;
  if (!limited) return null;
  return {
    ...(typeof e.provider === 'string' && e.provider ? { provider: e.provider } : {}),
    ...(typeof e.model === 'string' && e.model ? { model: e.model } : {}),
    ...(secs !== undefined ? { resetsAt: new Date(now + secs * 1000).toISOString() } : at ? { resetsAt: at } : {}),
  };
}

/** "Your server's Claude accounts are all at their limit for claude-opus-5-5. The first is free again at 4:10 PM (in 1 h 2 min)." */
export function serverLimitWords(l: ServerLimit, fallbackModel: string, now: Date = new Date()): string {
  const who = providerName(l.provider);
  const model = l.model ?? fallbackModel;
  const head = who ? `Your server’s ${who} accounts are all at their limit for ${model}.` : `Your server’s accounts for ${model} are all at their limit.`;
  return l.resetsAt ? `${head} The first is free again ${resetWords(l.resetsAt, now)}.` : `${head} It didn’t say when they reset.`;
}

/**
 * Claude Code's own words for a limit ("You've hit your weekly limit · resets 9am (America/Chicago)"), as one sentence
 * that names the app, the window and the reset time.
 */
export function claudeCodeLimitWords(text: string, resetsAt: string | null, now: Date = new Date()): string {
  const window = /weekly|7[- ]day|seven_day/i.test(text) ? 'weekly' : /5[- ]hour|five_hour|session/i.test(text) ? '5-hour' : '';
  const head = `Your Claude Code account has hit its ${window ? `${window} ` : ''}limit.`;
  return resetsAt ? `${head} It resets ${resetWords(resetsAt, now)}.` : `${head} Claude Code didn’t say when it resets.`;
}

/** A readable name for an id the server gave none for: claude-sonnet-4-5-20250929 → "Claude Sonnet 4.5". */
export function nameFromId(id: string): string {
  const bare = id.slice(id.lastIndexOf('/') + 1).replace(/-\d{8}$/, '');
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?$/.exec(bare);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  return bare
    .split('-')
    .map((w) => (/^gpt$/i.test(w) ? 'GPT' : w[0] ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
    .replace(/^GPT (\d)/, 'GPT-$1');
}
