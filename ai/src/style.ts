// "My style": durable user preferences, persisted in <Reel Studio root>/My style.json.
import { randomUUID } from 'node:crypto';
import { readJson, styleFile, writeFileAtomic } from './project';

/** A rule the app applies itself, through the caption tool, when a new video is made. Only lowercase for now:
 * the caption tool and the engine schema agree on `lower`, but not on sentence case. */
export interface CaptionCaseRule { kind: 'caption-case'; case: 'lower' }
/** The video and version whose note the rule came from. */
export interface StyleSource { project: string; title: string; version: number }
/** "Remember this for next time?" for a typed rule. Saved only when the person says Yes to exactly this. */
export interface StyleProposal { id: string; text: string; payload: CaptionCaseRule; source: StyleSource }

export interface StyleRule {
  id: string; text: string; createdAt: string;
  payload?: CaptionCaseRule;
  paused?: boolean;
  source?: StyleSource;
  /** the question the person said Yes to */
  consent?: { proposal: string; at: string };
}
/** `forgotten`: questions whose rule was removed, so answering one again cannot bring it back. IDs only. */
export interface StyleFile { version: 1; rules: StyleRule[]; forgotten?: string[] }
export type Approval = { status: 'saved' | 'exists'; rule: StyleRule } | { status: 'forgotten' };

export const LOWERCASE_CAPTIONS = 'Use lowercase captions.';
const isCaptionCase = (x: unknown): x is CaptionCaseRule => (x as CaptionCaseRule)?.kind === 'caption-case' && (x as CaptionCaseRule).case === 'lower';

const CAPTION_CASE_PROMPT = 'New videos start with lowercase captions (the app sets this). Use another case only when the note asks for it.';

export function captionCaseProposal(source: StyleSource): StyleProposal {
  return { id: randomUUID(), text: LOWERCASE_CAPTIONS, payload: { kind: 'caption-case', case: 'lower' }, source };
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim();

/** A rule as it is shown and stored: one sentence, capitalised, ending in a full stop. */
export function cleanRuleText(text: string): string {
  let clean = String(text ?? '').replace(/\s*—\s*/g, ', ').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('empty rule');
  if (!/[.!?]$/.test(clean)) clean += '.';
  return clean[0].toUpperCase() + clean.slice(1);
}

/** The user's note itself asks for a lasting habit ("always...", "from now on...", "remember...",
 * "in every video..."). Only then is a rule saved without asking; otherwise it is only proposed
 * (novice test: "I also saved this to My style" for a note that never asked was surprising). */
export function noteAsksToRemember(note: string | undefined): boolean {
  return !!note && /\b(always|never again|from now on|going forward|in (the )?future|remember|every (video|time|reel)|all (my|of my|future) (videos|reels)|for next time|next time)\b/i.test(note);
}

export class StyleStore {
  constructor(private readonly rootDir: () => string) {}

  /** add/remove are read-modify-write of one file shared by every project: run them one at a time
   * (two edits saving a rule at once used to drop one of them; review finding 36). */
  private chain: Promise<unknown> = Promise.resolve();
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.catch(() => undefined).then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  get file(): string { return styleFile(this.rootDir()); }

  /** No file is an empty My style. A file that can't be read throws, so no save replaces the rules in it. */
  private async read(): Promise<StyleFile> {
    let data: StyleFile;
    try { data = await readJson<StyleFile>(this.file); } catch (e: any) {
      if (e?.code === 'ENOENT') return { version: 1, rules: [] };
      throw e;
    }
    if (!Array.isArray(data?.rules)) throw new Error(`${this.file} has no rules list`);
    const forgotten = Array.isArray(data.forgotten) ? data.forgotten.filter((x) => typeof x === 'string') : [];
    return { version: 1, rules: data.rules.filter((r) => r && typeof r.text === 'string'), ...(forgotten.length ? { forgotten } : {}) };
  }

  /** What edits and the My style screen use: nothing when the file can't be read. */
  async list(): Promise<StyleRule[]> { return (await this.read().catch(() => null))?.rules ?? []; }

  private async write(data: StyleFile): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2) + '\n');
  }

  /** Adds a rule unless an equivalent one already exists. */
  async add(text: string): Promise<{ added: boolean; rule: StyleRule }> {
    return this.serial(() => this.addNow(text));
  }

  /** The saved rule equivalent to `text`, if any. */
  async find(text: string): Promise<StyleRule | undefined> {
    const n = normalize(cleanRuleText(text));
    return (await this.list()).find((r) => normalize(r.text) === n);
  }

  private async addNow(text: string): Promise<{ added: boolean; rule: StyleRule }> {
    const clean = cleanRuleText(text);
    const data = await this.read();
    const dup = data.rules.find((r) => normalize(r.text) === normalize(clean));
    if (dup) return { added: false, rule: dup };
    const rule: StyleRule = { id: randomUUID(), text: clean, createdAt: new Date().toISOString() };
    await this.write({ ...data, rules: [...data.rules, rule] });
    return { added: true, rule };
  }

  /** The person said Yes to `p`: the rule and its consent are saved in one write. Answering the same question
   * again returns the same rule, and the question of a rule they removed cannot bring it back. */
  async approve(p: StyleProposal): Promise<Approval> {
    return this.serial(async () => {
      if (!p?.id || p.text !== LOWERCASE_CAPTIONS || !isCaptionCase(p.payload)) throw new Error('the question does not match the rule it would save');
      const data = await this.read();
      if (data.forgotten?.includes(p.id)) return { status: 'forgotten' };
      const same = data.rules.find((r) => r.consent?.proposal === p.id);
      if (same) return { status: 'saved', rule: same };
      const typed = data.rules.find((r) => isCaptionCase(r.payload));
      if (typed) return { status: 'exists', rule: typed };
      const at = new Date().toISOString();
      const fields = {
        text: LOWERCASE_CAPTIONS, payload: { kind: 'caption-case', case: 'lower' } as const,
        source: { project: String(p.source?.project ?? ''), title: String(p.source?.title ?? '').slice(0, 120), version: Number(p.source?.version) || 0 },
        consent: { proposal: p.id, at },
      };
      // The same words saved as a plain sentence give way to the typed rule. It gets a new ID: a running note
      // that saved that sentence removes it by ID if the note fails, and must not take the approved rule with it.
      const rule: StyleRule = { id: randomUUID(), createdAt: at, ...fields };
      const rest = data.rules.filter((r) => normalize(r.text) !== normalize(LOWERCASE_CAPTIONS));
      await this.write({ ...data, rules: [...rest, rule] });
      return { status: 'saved', rule };
    });
  }

  /** The person said No to `p`. If a Yes to it was saved before a crash cut off the reply, that rule goes,
   * and the question is remembered as answered so it cannot save again. */
  async decline(p: StyleProposal): Promise<void> {
    return this.serial(async () => {
      const data = await this.read();
      if (!data.rules.some((r) => r.consent?.proposal === p.id)) return;
      await this.write({ ...data, rules: data.rules.filter((r) => r.consent?.proposal !== p.id), forgotten: [...(data.forgotten ?? []), p.id] });
    });
  }

  /** New words make a typed rule a plain one: the app cannot apply "lowercase captions for tutorials" itself. */
  async update(id: string, patch: { text?: string; paused?: boolean }): Promise<StyleRule> {
    return this.serial(async () => {
      const data = await this.read();
      const rule = data.rules.find((r) => r.id === id);
      if (!rule) throw new Error('that rule is not in My style any more');
      if (patch.text !== undefined) {
        rule.text = cleanRuleText(patch.text);
        if (rule.payload && rule.text !== LOWERCASE_CAPTIONS) delete rule.payload;
      }
      if (patch.paused === true) rule.paused = true;
      if (patch.paused === false) delete rule.paused;
      await this.write(data);
      return rule;
    });
  }

  async remove(id: string): Promise<void> {
    return this.serial(async () => {
      const data = await this.read();
      const asked = data.rules.find((r) => r.id === id)?.consent?.proposal;
      await this.write({ ...data, rules: data.rules.filter((r) => r.id !== id), ...(asked ? { forgotten: [...(data.forgotten ?? []), asked] } : {}) });
    });
  }

  /** The caption case an active typed rule asks for. Only this checked value leaves the store. */
  async captionCase(): Promise<'lower' | null> {
    return (await this.list()).some((r) => !r.paused && isCaptionCase(r.payload)) ? 'lower' : null;
  }

  /** A typed lowercase rule is already in My style, paused or not. */
  async hasCaptionCase(): Promise<boolean> {
    return (await this.list()).some((r) => isCaptionCase(r.payload));
  }

  async asPromptText(): Promise<string> {
    const rules = (await this.list()).filter((r) => !r.paused);
    return rules.length ? rules.map((r) => `- ${isCaptionCase(r.payload) ? CAPTION_CASE_PROMPT : r.text}`).join('\n') : '(none yet)';
  }
}
