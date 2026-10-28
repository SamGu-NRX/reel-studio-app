// Try 2 for a trial post: the editor picks the one thing to change from the reel as it is, and says why.
// The app makes the files (app/src/main/platform-export.ts); this only decides.
import type { Prompts } from './prompts';
import { extractJson } from './providers/cli';
import { cleanSummary } from './tools';
import { AIError, type ModelProvider } from './types';

export type TryVariable = 'hook' | 'cover' | 'caption' | 'brightness';
export const TRY_VARIABLES: readonly TryVariable[] = ['hook', 'cover', 'caption', 'brightness'];

export interface TryRequest {
  /** Try 1's caption as it will be posted, hashtags included. Its first line is the hook line. */
  caption: string;
  /** The finished reel's length in seconds. */
  duration: number;
  /** What is said, on the finished reel's clock: each word's start and end, so a cover can fall between words. */
  words: { w: string; s: number; e: number }[];
  /** The current cover on the reel's clock, when known. */
  coverSeconds: number | null;
  /** The creator swapped to this one: change only it. */
  variable?: TryVariable;
}

export type TryProposal =
  | { variable: 'hook' | 'caption'; value: string; reason: string }
  | { variable: 'cover' | 'brightness'; value: number; reason: string };

const HOOK_MAX = 120;
const BODY_MAX = 600;
const REASON_MAX = 200;
const BRIGHTNESS = { min: 0.02, max: 0.15 };

const firstLine = (caption: string): string => caption.split('\n')[0];
const body = (caption: string): string => caption.split('\n').slice(1).join('\n');

/** The proposal in `j`, or what is wrong with it. */
export function checkTryProposal(j: any, req: TryRequest): { proposal: TryProposal } | { problems: string[] } {
  const problems: string[] = [];
  const variable = j?.variable;
  const reason = typeof j?.reason === 'string' ? cleanSummary(j.reason) : '';
  if (!TRY_VARIABLES.includes(variable)) problems.push('variable must be "hook", "cover", "caption" or "brightness"');
  else if (req.variable && variable !== req.variable) problems.push(`variable must be "${req.variable}"`);
  if (!reason) problems.push('reason is missing');
  else if (reason.length > REASON_MAX) problems.push(`reason is longer than ${REASON_MAX} characters`);
  if (problems.length) return { problems };
  if (variable === 'hook' || variable === 'caption') {
    const value = typeof j.value === 'string' ? cleanSummary(j.value) : '';
    if (variable === 'hook' && (!value || value.includes('\n') || value.length > HOOK_MAX)) problems.push(`value must be one line of at most ${HOOK_MAX} characters`);
    if (variable === 'hook' && value === firstLine(req.caption).trim()) problems.push('value is the same hook line as now');
    if (variable === 'caption' && (!value || value.length > BODY_MAX)) problems.push(`value must be the rest of the caption, at most ${BODY_MAX} characters`);
    if (variable === 'caption' && value === body(req.caption).trim()) problems.push('value is the same caption as now');
    return problems.length ? { problems } : { proposal: { variable, value, reason } };
  }
  const value = typeof j.value === 'number' ? j.value : Number.NaN;
  if (variable === 'cover' && !(value >= 0 && value <= req.duration)) problems.push(`value must be seconds from 0 to ${req.duration.toFixed(1)}`);
  if (variable === 'cover' && req.coverSeconds !== null && Math.abs(value - req.coverSeconds) < 0.5) problems.push('value is the same frame as the current cover');
  if (variable === 'brightness' && !(Math.abs(value) >= BRIGHTNESS.min && Math.abs(value) <= BRIGHTNESS.max)) problems.push(`value must be from ${BRIGHTNESS.min} to ${BRIGHTNESS.max} brighter or darker`);
  return problems.length ? { problems } : { proposal: { variable, value: Math.round(value * 1000) / 1000, reason } };
}

function describe(req: TryRequest): string {
  const said = req.words.map((w) => `[${w.s.toFixed(1)}-${w.e.toFixed(1)}] ${w.w}`).join(' ');
  return [
    `The reel is ${req.duration.toFixed(1)} s long.`,
    `What is said, with the seconds each word starts and ends: ${said || '(nothing)'}`,
    `The current cover is ${req.coverSeconds === null ? 'a frame the editor picked earlier' : `the frame at ${req.coverSeconds.toFixed(1)} s`}.`,
    `The hook line (the caption's first line): ${firstLine(req.caption) || '(empty)'}`,
    `The rest of the caption: ${body(req.caption) || '(empty)'}`,
    req.variable ? `The creator wants Try 2 to change the ${req.variable === 'hook' ? 'hook line' : req.variable}. Change only that.` : '',
    'Reply with ONLY the JSON object {"variable": string, "value": string or number, "reason": string}.',
  ].filter(Boolean).join('\n\n');
}

/** One change for Try 2, decided by the editor. Throws an AIError when the editor gives no usable answer. */
export async function proposeTry(prompts: Prompts, provider: ModelProvider | null, req: TryRequest, signal?: AbortSignal): Promise<TryProposal> {
  if (!provider) throw new AIError('no_ai', 'Connect an editor to have it choose Try 2.');
  const system = prompts.render('proposeTry');
  const messages: any[] = [{ role: 'user', content: [{ type: 'text', text: describe(req) }] }];
  let problems: string[] = [];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await provider.complete({ system, messages, tools: [], jsonOnly: true, signal });
      const j = extractJson(res.text);
      const checked = j ? checkTryProposal(j, req) : { problems: ['reply was not the JSON object'] };
      if ('proposal' in checked) return checked.proposal;
      problems = checked.problems;
      messages.push({ role: 'assistant', text: res.text, toolCalls: [] });
      messages.push({ role: 'user', content: [{ type: 'text', text: `Problems: ${problems.join('; ')}. Fix them and reply with ONLY the corrected JSON.` }] });
    }
  } finally {
    await provider.dispose?.();
  }
  throw new AIError('try_failed', 'I could not choose Try 2 this time.', { detail: problems.join('; ') });
}
