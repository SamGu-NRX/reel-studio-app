// More reels from one video: the editor reads the whole transcript and proposes the distinct reels inside it. One
// JSON-only call, checked here, asked once more with the problems when the check fails. Read-only: the app makes a
// reel from each pick (app/src/main/propose-reels.ts).
import { waitWords } from './agent';
import { formatForPicking, type PickTakesInput } from './editor';
import { anchorProblem, anchorText, anchorWords, approxDuration, normalizeKeep, sentenceEdges, wordIndex, type WordAnchor } from './project';
import type { Prompts } from './prompts';
import { extractJson } from './providers/cli';
import { cleanSummary } from './tools';
import { AIError, type AgentEvent, type ModelProvider } from './types';

export interface ProposeReelsRequest {
  /** The video's words, as pickTakes reads them. */
  transcript: PickTakesInput;
  /** project.json cut.gapCap: a reel's length is measured the way the engine will play it. */
  gapCap: number;
  /** The reel's title, so no proposed title repeats it. */
  title: string;
  /** Words no proposal may use: this reel's cut and the reels already made from it. */
  taken: WordAnchor[];
  /** At most this many reels (REEL_LIMIT). */
  limit?: number;
}

export interface ReelCandidate {
  /** r1, r2, … in the editor's order, which is its ranking. Stable within one proposal. */
  id: string;
  title: string;
  /** The opening line: starts on keep[0]'s first word and ends inside keep[0]. */
  hook: WordAnchor;
  /** Inclusive word ranges in play order, without joins. */
  keep: WordAnchor[];
  /** One sentence in the editor's voice: what the reel is and why it stands on its own. */
  why: string;
  /** Measured from the words (approxDuration). A number in the reply is never read. */
  seconds: number;
  words: number;
}

export interface ReelProposal { candidates: ReelCandidate[]; notes: string; attempts: number }

/** The lead's choices for slice 1; no measured run sits behind them (notes/design/r11/more-reels.md). */
export const REEL_SECONDS = { min: 15, max: 90 } as const;
export const REEL_LIMIT = 5;

const TITLE_MAX = 60;
const WHY_MAX = 140;
const HOOK_WORDS = 20;
/** What the strip says while the editor reads the video (the app emits it first; a wait reverts to it). */
const FINDING = 'Finding the reels in your video';

const quoted = (s: string, max = 60) => `"${s.length > max ? `${s.slice(0, max - 1)}…` : s}"`;

/**
 * The proposal in `j`, or what is wrong with it. An empty list is a proposal: the video reads as one piece.
 * Each problem names the reel (r1 is the first in the reply) so the retry can fix it.
 */
export function checkReelProposal(j: unknown, req: ProposeReelsRequest): { proposal: Omit<ReelProposal, 'attempts'> } | { problems: string[] } {
  const limit = req.limit ?? REEL_LIMIT;
  const raw = (j as { candidates?: unknown })?.candidates;
  if (!Array.isArray(raw) || raw.length > limit || raw.some((c) => !c || typeof c !== 'object' || Array.isArray(c))) {
    return { problems: [`candidates must be a list of at most ${limit} reel objects`] };
  }
  const t = req.transcript;
  const idx = wordIndex(t);
  const edges = sentenceEdges(t);
  const problems: string[] = [];
  // word ids run on across sources, so an ordered range can still start in one video and end in the next
  const crossesSources = (a: WordAnchor) => new Set(anchorWords(t, a).map((w) => w.source)).size > 1;
  const say = (word: string) => `${word} (${quoted(String(t.words[idx.byId.get(word)!]?.w ?? '').trim(), 30)})`;

  // every word already spoken for: by TAKEN, then by each reel as it is checked
  const owner = new Map<string, { by: string; range: string }>();
  for (const a of req.taken) {
    if (anchorProblem(idx, a)) continue;
    for (const w of anchorWords(t, a)) owner.set(w.id, { by: 'TAKEN', range: `${a.from}..${a.to}` });
  }
  const titles = new Map<string, string>();
  const out: ReelCandidate[] = [];

  raw.forEach((c: Record<string, unknown>, i) => {
    const id = `r${i + 1}`;
    const before = problems.length;

    const title = typeof c.title === 'string' ? cleanSummary(c.title) : '';
    if (!title) problems.push(`${id}: title is missing`);
    else if (/[\r\n]/.test(title) || title.length > TITLE_MAX) problems.push(`${id}: title must be one line of at most ${TITLE_MAX} characters`);
    else if (title.toLowerCase() === req.title.trim().toLowerCase()) problems.push(`${id}: title is the video's own title`);
    else if (titles.has(title.toLowerCase())) problems.push(`${id}: title is the same as ${titles.get(title.toLowerCase())}'s`);
    else titles.set(title.toLowerCase(), id);

    const keepRaw = Array.isArray(c.keep) ? c.keep : [];
    if (!keepRaw.length) problems.push(`${id}: keep has no ranges`);
    keepRaw.forEach((a: any, k) => {
      if (a?.join != null) problems.push(`${id}: keep[${k}] has a join; a proposed reel plays its ranges without joins`);
    });
    const { keep, problems: keepProblems } = normalizeKeep(t, keepRaw.map((a: any) => ({ from: String(a?.from), to: String(a?.to) })));
    problems.push(...keepProblems.map((p) => `${id}: ${p}`));
    const keepOk = keepRaw.length > 0 && !keepProblems.length;

    if (keepOk) {
      keep.forEach((a, k) => {
        const range = `${a.from}..${a.to}`;
        const clash = anchorWords(t, a).find((w) => owner.has(w.id));
        if (clash) {
          const o = owner.get(clash.id)!;
          problems.push(`${id}: keep[${k}] (${range}) uses ${clash.id}, which ${o.by === 'TAKEN' ? 'TAKEN already has' : `${o.by} uses`} (${o.range})`);
        }
        if (crossesSources(a)) problems.push(`${id}: keep[${k}] (${range}) runs from one video into another; keep each range inside one video`);
        if (edges.marked && !edges.starts.has(a.from)) problems.push(`${id}: keep[${k}] starts at ${say(a.from)}, in the middle of a sentence; start on a sentence's first word`);
        if (edges.marked && !edges.ends.has(a.to)) problems.push(`${id}: keep[${k}] ends at ${say(a.to)}, in the middle of a sentence; end on a sentence's last word`);
      });
      for (const a of keep) for (const w of anchorWords(t, a)) if (!owner.has(w.id)) owner.set(w.id, { by: id, range: `${a.from}..${a.to}` });
    }

    const hookRaw = c.hook as { from?: unknown; to?: unknown } | undefined;
    const hook = { from: String(hookRaw?.from), to: String(hookRaw?.to) };
    if (anchorProblem(idx, hook)) problems.push(`${id}: hook must be a word range ({"from": "wX", "to": "wY"})`);
    else if (keepOk) {
      const [first] = keep;
      const at = idx.byId.get(hook.to)!;
      if (hook.from !== first.from || at < idx.byId.get(first.from)! || at > idx.byId.get(first.to)!) {
        problems.push(`${id}: hook must start on keep[0]'s first word (${first.from}) and end inside keep[0] (${first.from}..${first.to})`);
      } else if (anchorWords(t, hook).length > HOOK_WORDS) problems.push(`${id}: hook is longer than ${HOOK_WORDS} words`);
    }
    if (!anchorProblem(idx, hook) && crossesSources(hook)) problems.push(`${id}: hook runs from one video into another`);

    const seconds = keepOk ? approxDuration(t, keep, req.gapCap) : 0;
    if (keepOk && (seconds < REEL_SECONDS.min || seconds > REEL_SECONDS.max)) {
      problems.push(`${id}: plays for ${seconds.toFixed(1)} s; a reel plays for ${REEL_SECONDS.min} to ${REEL_SECONDS.max} s`);
    }

    const why = typeof c.why === 'string' ? cleanSummary(c.why) : '';
    if (!why) problems.push(`${id}: why is missing`);
    else if (why.length > WHY_MAX || /[\r\n]/.test(why) || /[.?!]["'”’)]*\s+\S/.test(why)) problems.push(`${id}: why must be one sentence of at most ${WHY_MAX} characters`);

    if (problems.length === before) {
      out.push({ id, title, hook, keep, why, seconds, words: keep.reduce((n, a) => n + anchorWords(t, a).length, 0) });
    }
  });

  if (problems.length) return { problems };
  const notes = (j as { notes?: unknown }).notes;
  return { proposal: { candidates: out, notes: typeof notes === 'string' ? cleanSummary(notes) : '' } };
}

function describe(req: ProposeReelsRequest): string {
  const t = req.transcript;
  const idx = wordIndex(t);
  const taken = req.taken.filter((a) => !anchorProblem(idx, a)).map((a) => `${a.from}-${a.to} ${quoted(anchorText(t, a), 200)}`);
  return [
    formatForPicking(t),
    taken.length ? `TAKEN (ranges already made into reels)\n${taken.join('\n')}` : 'TAKEN: none',
    `Video title: ${req.title}`,
    `Propose at most ${req.limit ?? REEL_LIMIT} reels. Reply with ONLY the JSON object {"candidates": [{"title": string, "hook": {"from": "wX", "to": "wY"}, "keep": [{"from": "wX", "to": "wY"}], "why": string}], "notes": string}.`,
  ].join('\n\n');
}

/**
 * The reels the editor finds in one video, best first. `onEvent` hears the waits for the editor's answer and a trace
 * line when the transcript has nothing to tell sentences apart. Throws AIError: no_ai, no_words, propose_failed.
 */
export async function proposeReels(prompts: Prompts, provider: ModelProvider | null, req: ProposeReelsRequest, signal?: AbortSignal, onEvent?: (e: AgentEvent) => void): Promise<ReelProposal> {
  if (!provider) throw new AIError('no_ai', 'Connect an editor to find more reels in this video.');
  if (!req.transcript?.words?.length) throw new AIError('no_words', "I didn't hear any words in this video, so there are no reels to find in it.");
  if (!sentenceEdges(req.transcript).marked) {
    onEvent?.({ type: 'trace', text: 'more reels: the transcript has no punctuation and no pause, so any word may start or end a reel' });
  }
  const system = prompts.render('proposeReels');
  const messages: any[] = [{ role: 'user', content: [{ type: 'text', text: describe(req) }] }];
  let problems: string[] = [];
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal?.aborted) throw new AIError('cancelled', 'Stopped.');
      const wait = onEvent ? waitWords(provider, (message, waiting) => onEvent({ type: 'status', message, thinking: true, ...(waiting ? { waiting } : {}) }), FINDING) : null;
      let res;
      try {
        res = await provider.complete({ system, messages, tools: [], jsonOnly: true, signal, onWait: wait?.onWait });
      } finally {
        wait?.end();
      }
      const j = extractJson(res.text);
      const checked = j ? checkReelProposal(j, req) : { problems: ['reply was not the JSON object'] };
      if ('proposal' in checked) return { ...checked.proposal, attempts: attempt };
      problems = checked.problems;
      messages.push({ role: 'assistant', text: res.text, toolCalls: [], raw: res.raw });
      messages.push({ role: 'user', content: [{ type: 'text', text: `Problems (r1 is the first reel in your reply, r2 the second, and so on): ${problems.join('; ')}. Fix them and reply with ONLY the corrected JSON.` }] });
    }
  } finally {
    await provider.dispose?.();
  }
  throw new AIError('propose_failed', "I couldn't find the reels in this video this time.", { detail: problems.join('; ') });
}
