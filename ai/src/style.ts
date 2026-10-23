// "My style": durable user preferences, persisted in <Reel Studio root>/My style.json.
import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { readJson, styleFile, writeFileAtomic } from './project';

export interface StyleRule { id: string; text: string; createdAt: string }
export type MemoryKind = 'captions' | 'pacing' | 'music' | 'cuts' | 'look';
export interface TrialLink {
  project: string; parentVersion: number; version: number; parentPostId: string; postId: string;
  /** Relative to Projects, with the trials.json array index as a JSON pointer. */
  href: string;
}
export interface MemoryProposal {
  id: string; kind: MemoryKind; line: string; text: string; proposedAt: string;
  from: { kind: 'note'; project: string; title: string; version: number; note?: string }
    | { kind: 'results'; reels: string[]; metric: string; change: number; n: number; evidence: string; trials: TrialLink[] };
}
export type ProposalDraft = Omit<MemoryProposal, 'id' | 'proposedAt'>;
export type ProposalStatus = 'added' | 'duplicate' | 'forgotten' | 'full';
export interface StyleFile { version: 1; rules: StyleRule[]; forgotten?: string[]; proposals?: MemoryProposal[] }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isRule(value: unknown): value is StyleRule {
  return record(value) && typeof value.id === 'string' && typeof value.text === 'string' && typeof value.createdAt === 'string';
}
function isTrialLink(value: unknown): value is TrialLink {
  return record(value) && typeof value.project === 'string' && Number.isSafeInteger(value.parentVersion)
    && Number.isSafeInteger(value.version) && typeof value.parentPostId === 'string' && typeof value.postId === 'string' && typeof value.href === 'string';
}
function isProposal(value: unknown): value is MemoryProposal {
  if (!record(value) || typeof value.id !== 'string' || typeof value.proposedAt !== 'string'
    || typeof value.text !== 'string' || typeof value.line !== 'string' || value.line.length > 60
    || typeof value.kind !== 'string' || !['captions', 'pacing', 'music', 'cuts', 'look'].includes(value.kind) || !record(value.from)) return false;
  const source = value.from;
  return source.kind === 'note'
    ? typeof source.project === 'string' && typeof source.title === 'string' && typeof source.version === 'number'
      && (source.note === undefined || typeof source.note === 'string')
    : source.kind === 'results' && Array.isArray(source.reels) && source.reels.every((r) => typeof r === 'string')
      && typeof source.metric === 'string' && typeof source.change === 'number' && Number.isFinite(source.change)
      && typeof source.n === 'number' && Number.isSafeInteger(source.n) && source.n > 0
      && typeof source.evidence === 'string' && Array.isArray(source.trials) && source.trials.every(isTrialLink);
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

  async list(): Promise<StyleRule[]> {
    if (!fs.existsSync(this.file)) return [];
    try {
      const data = await readJson<StyleFile>(this.file);
      return Array.isArray(data?.rules) ? data.rules.filter((r) => r && typeof r.text === 'string') : [];
    } catch { return []; }
  }

  private async read(): Promise<StyleFile> {
    if (!fs.existsSync(this.file)) return { version: 1, rules: [] };
    try {
      const data = await readJson<unknown>(this.file);
      if (!record(data) || data.version !== 1 || !Array.isArray(data.rules) || !data.rules.every(isRule)
        || (data.forgotten !== undefined && (!Array.isArray(data.forgotten) || !data.forgotten.every((s) => typeof s === 'string')))
        || (data.proposals !== undefined && (!Array.isArray(data.proposals) || !data.proposals.every(isProposal)))) throw new Error();
      return { ...data, version: 1, rules: data.rules,
        forgotten: data.forgotten, proposals: data.proposals };
    } catch { throw new Error('The memory file could not be read. Restore it before saving memories.'); }
  }

  private async write(data: StyleFile): Promise<void> {
    await writeFileAtomic(this.file, JSON.stringify(data, null, 2) + '\n');
  }

  private status(data: StyleFile, proposal: ProposalDraft): ProposalStatus | 'new' {
    const text = normalize(cleanRuleText(proposal.text));
    const id = proposalId(text);
    if (data.forgotten?.some((forgotten) => forgotten === id || normalize(forgotten) === text)) return 'forgotten';
    if (data.rules.some((r) => normalize(r.text) === text) || data.proposals?.some((p) => normalize(p.text) === text)) return 'duplicate';
    return (data.proposals?.length ?? 0) >= 3 ? 'full' : 'new';
  }

  async proposalStatus(proposal: ProposalDraft): Promise<ProposalStatus | 'new'> {
    return this.status(await this.read(), proposal);
  }

  async propose(proposal: ProposalDraft): Promise<ProposalStatus> {
    return this.serial(async () => {
      const data = await this.read();
      const status = this.status(data, proposal);
      if (status !== 'new') return status;
      const text = cleanRuleText(proposal.text);
      const saved = { ...proposal, text, id: proposalId(normalize(text)), proposedAt: new Date().toISOString() };
      if (!isProposal(saved)) throw new Error('Invalid memory proposal. Supply a kind, a short line and its evidence.');
      await this.write({ ...data, proposals: [...(data.proposals ?? []), saved] });
      return 'added';
    });
  }

  async dismiss(id: string): Promise<void> {
    return this.serial(async () => {
      const data = await this.read();
      const proposal = data.proposals?.find((p) => p.id === id);
      if (!proposal) return;
      await this.write({ ...data, proposals: data.proposals?.filter((p) => p.id !== id),
        forgotten: [...new Set([...(data.forgotten ?? []), id, normalize(proposal.text)])] });
    });
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
    const rules = data.rules;
    const dup = rules.find((r) => normalize(r.text) === normalize(clean));
    if (dup) return { added: false, rule: dup };
    const rule: StyleRule = { id: randomUUID(), text: clean, createdAt: new Date().toISOString() };
    await this.write({ ...data, rules: [...rules, rule] });
    return { added: true, rule };
  }

  async remove(id: string, options: { forget?: boolean } = {}): Promise<void> {
    return this.serial(async () => {
      const data = await this.read();
      const rule = data.rules.find((r) => r.id === id);
      if (!rule) return;
      await this.write({ ...data, rules: data.rules.filter((r) => r.id !== id),
        forgotten: options.forget === false ? data.forgotten : [...new Set([...(data.forgotten ?? []), id, normalize(rule.text)])] });
    });
  }

  async asPromptText(): Promise<string> {
    const rules = await this.list();
    return rules.length ? rules.map((r) => `- ${r.text}`).join('\n') : '(none yet)';
  }
}

function proposalId(text: string): string {
  return 'proposal-' + createHash('sha256').update(text).digest('hex');
}
