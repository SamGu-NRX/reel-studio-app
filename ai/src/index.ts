// @reelstudio/ai: providers, prompts, tools and the editor agent loop (docs/architecture.md sections 6 and 8).
import { StockSearch, StockProvider } from './stock';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  AgentEvent, AgentResult, AIError, EngineHost, ModelProvider, Part, PlanTurnInput, PlanTurnResult, ProviderId, ProviderStatus, ScriptResult, SecretStore, UserFacingError,
} from './types';
import { Prompts, defaultPromptsDir } from './prompts';
import { StyleStore, StyleProposal, StyleRule } from './style';
import { loadProject, writeFileAtomic } from './project';
import { planFastNote } from './fastnote';
import { AnthropicProvider, DEFAULT_CLAUDE_MODEL, SMALL_CLAUDE_MODEL } from './providers/anthropic';
import { SiwcAuth } from './providers/siwc';
import { OpenAIResponsesProvider, listChatGPTModels } from './providers/openai';
import { ClaudeCliProvider, CodexCliProvider, extractJson } from './providers/cli';
import { ReplayProvider } from './providers/replay';
import { CONNECTION_KINDS, ConnectionKind, listConnectionModels, noRedirectFetch, normalizeBaseURL, suggestedModel } from './providers/connection';
import { OpenAICompatibleProvider } from './providers/openaiCompatible';
import { hubAccounts, hubModels, hubProvider, splitModel, familyOf, type HubAccount, type HubModel } from './providers/hub';
import { nameFromId } from './providers/limits';
import { readCodexAccount } from './providers/codexAccount';
import { ClaudeCodeHarness } from './mcp/claudeCode';
import { CodexHarness } from './mcp/codex';
import { SessionHarness } from './mcp/session';
import type { Harness } from './harness';
import { detectLocalClaude, DetectOptions, LocalClaude } from './providers/localClaude';
import { detectCodex, CodexDetectOptions, LocalCodex } from './providers/localCodex';
import * as editor from './editor';
import { proposeTry, type TryProposal, type TryRequest } from './trial';
import { proposeReels, type ProposeReelsRequest, type ReelProposal } from './propose';
import { refuseIfOpen } from './owner';

export * from './types';
export { StockSearch } from './stock';
export type { StockProvider, StockKind, StockResult } from './stock';
export * from './project';
export * from './version-merge';
export { refuseIfOpen, OWNER_LOCK } from './owner';
export { TOOLS, TOOL_NAMES, toolSchemas, executeTool, newToolState } from './tools';
export { CUT_STYLES } from './cut-style';
export type { CutPreset } from './cut-style';
export type { ToolContext, ToolDef } from './tools';
export { runAgent } from './agent';
export { loopHarness } from './harness';
export type { Harness, HarnessRun } from './harness';
export { ClaudeCodeHarness } from './mcp/claudeCode';
export { CodexHarness } from './mcp/codex';
export { SessionHarness } from './mcp/session';
export { Prompts } from './prompts';
export { StyleStore } from './style';
export type { MemoryKind, MemoryProposal, ProposalDraft, ProposalStatus, TrialLink } from './style';
export { learn, MIN_LEARNING_REACH } from './learning';
export { AnthropicProvider, DEFAULT_CLAUDE_MODEL } from './providers/anthropic';
export { SiwcAuth, USAGE_URL } from './providers/siwc';
export { OpenAIResponsesProvider, listChatGPTModels, mapResponsesError } from './providers/openai';
export { ClaudeCliProvider, CodexCliProvider } from './providers/cli';
export { ReplayProvider, RecordingProvider } from './providers/replay';
export { OpenAICompatibleProvider } from './providers/openaiCompatible';
export type { ConnectionKind } from './providers/connection';
export { hubModels, hubAccounts, splitModel, joinModel, familyOf, EFFORTS } from './providers/hub';
export type { HubModel, HubAccount, Effort, ModelFamily } from './providers/hub';
export { resetWords } from './providers/limits';
export { detectLocalClaude, findClaude, claudeCandidates, claudeFromLoginShell, CLAUDE_CODE_MESSAGES } from './providers/localClaude';
export type { LocalClaude, ClaudeCodeState } from './providers/localClaude';
export { classifyCodexLoginStatus, detectCodex, findCodex, codexCandidates, codexFromLoginShell, CODEX_MESSAGES } from './providers/localCodex';
export type { CodexLoginStatus, LocalCodex, CodexState } from './providers/localCodex';
export { cliEnv } from './safety';
export { pickTakes, formatForPicking, deterministicEdit } from './editor';
export type { ApplyNoteOptions } from './editor';
export { checkTryProposal, TRY_VARIABLES } from './trial';
export type { TryProposal, TryRequest, TryVariable } from './trial';
export { checkReelProposal, proposeReels } from './propose';
export type { ProposeReelsRequest, ReelCandidate, ReelProposal } from './propose';
export { ATTACHMENT_REF, MAX_ATTACHMENTS_PER_NOTE, readAttachment, listAttachments, validateAttachments, placedAssets } from './attachments';
export type { AttachmentInfo } from './attachments';

/**
 * Every stage of the work that calls a model, each with its own model choice (Settings › Editor). `editor` makes
 * Version 1 and the notes' changes; `checker` reviews an edit and proofreads Version 1's subtitles; `writer` writes
 * scripts; `planner` is the planning chat; `finder` finds more reels in a video; `trial` picks Try 2's one change;
 * `namer` rewords a version's title.
 */
export const MODEL_ROLES = ['editor', 'checker', 'writer', 'planner', 'finder', 'trial', 'namer'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];
/** A model per role, optionally with a reasoning level (`claude-opus-5-5(high)`); missing or 'auto' leaves it to the
 * editor's own default. */
export type RoleModels = Partial<Record<ModelRole, string>>;
/** Claude Code's model names, as `claude --help` lists them for `--model` (2.1.311). */
export const CLAUDE_CODE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
/** `claude --help` 2.1.311: --effort takes these. */
const CLAUDE_CODE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const ROLE_NAMES: Record<ModelRole, string> = {
  editor: 'Edits', checker: 'Checks each edit', writer: 'Writes scripts', planner: 'Plans reels', finder: 'Finds more reels', trial: 'Picks Try 2', namer: 'Names versions',
};

/**
 * The model `role` asks the active editor for, as stored (it may carry a reasoning level). Claude Code, the Codex app
 * and your own server take a model name; a Claude key picks its own, so a choice does not apply to it. A name the
 * editor cannot run (left from another editor) is refused by name rather than sent.
 */
export function modelForRole(provider: ProviderId, role: ModelRole, choices: RoleModels): string | undefined {
  const m = choices[role];
  if (!m || m === 'auto') return undefined;
  const { model } = splitModel(m);
  const refuse = (app: string) => new AIError('model_not_offered', `${app} doesn't offer "${model}", the model chosen for ${ROLE_NAMES[role]}. Choose another in Settings, under Editor, or Auto.`);
  if (provider === 'claude-cli') {
    if (CLAUDE_CODE_MODELS.includes(model) || /^claude-[\w.-]+$/.test(model)) return m;
    throw refuse('Your Claude Code app');
  }
  if (provider === 'codex-cli') {
    if (familyOf(model) === 'gpt') return m;
    throw refuse('Your Codex app');
  }
  return provider === 'custom' ? m : undefined;
}

export interface AISettings {
  active?: ProviderId;
  claudeModel?: string;
  chatgptModel?: string;
  cliModel?: string;
  /** the model for "ChatGPT (your Codex app)"; unset = the Codex app's own default for the person's plan */
  codexModel?: string;
  replayFixture?: string;
  /** each connection's key is its own encrypted file, never in here */
  connections?: CustomConnection[];
  activeConnection?: string;
  /** Dev only: the selected CLI runs notes with the app's tools over MCP. "Double-check each edit" is the app's
   * setting (#73), passed with each note. */
  harness?: 'claude-code' | 'codex';
  /** set when the old in-app "Sign in with ChatGPT" was signed out on upgrade; cleared once the Codex app is chosen */
  chatgptMoved?: boolean;
}

export interface CustomConnection {
  /** 'cliproxy': CLIProxyAPI on this computer, found by the app. `baseURL` is its origin, and each model goes to the
   * endpoint for its family (providers/hub.ts). */
  id: string; label: string; kind: ConnectionKind | 'cliproxy'; baseURL: string; model: string;
  /** set by the picture sent with the check on save; the person can change it */
  supportsImages: boolean;
  /** where the key came from, said in the editor's row: a config file's path, or "typed" */
  keySource?: string;
}
export interface ConnectionInfo extends CustomConnection { hasKey: boolean; active: boolean; hasManagementKey?: boolean }
/** A model the editor in use offers, for the stage picker. */
export type EditorModel = HubModel;
/** The accounts behind the editor in use, their plans and what each has left. */
export interface EditorAccounts {
  accounts: { name: string; provider: string; plan?: string; windows: import('./types').LimitWindow[]; restingUntil?: string; problem?: string }[];
  /** CLIProxyAPI without its management key: accounts need it */
  needsManagementKey?: boolean;
  /** the accounts could not be read; in plain words */
  problem?: string;
}
export interface TestResult { provider: ProviderId | 'fake'; model?: string; reply: string; ms: number; limits?: import('./types').LimitWindow[] }
export interface ConnectionInput {
  id?: string;
  label: string; kind: ConnectionKind; baseURL: string; model: string;
  /** empty keeps the stored key when editing */
  key?: string;
}
export interface ConnectionModels { models: string[]; suggested: string | null; needsKey: boolean }
export type ConnectionField = 'label' | 'address' | 'key' | 'model';
export interface SaveConnectionResult {
  status: ProviderStatus;
  connection?: ConnectionInfo;
  error?: UserFacingError & { field?: ConnectionField };
}

const CONNECTION_ID = /^c_[a-f0-9]{8}$/;
function sameOrigin(a: string, b: string): boolean {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}
const CHECK_TIMEOUT_MS = 30_000;
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const WEAK_STORE_MESSAGE = 'This computer has no password store Reel Studio can use (such as GNOME Keyring or KWallet), so other apps could read the key. It was not saved. Turn on your password store, then try again.';
const FIELD_OF: Record<string, ConnectionField> = {
  connection_bad_address: 'address', connection_unreachable: 'address', connection_wrong_address: 'address', connection_timeout: 'address',
  connection_bad_key: 'key', no_secure_storage: 'key', connection_model: 'model',
};

export interface CreateAIOptions {
  host: EngineHost;
  settingsDir: string;
  dev?: boolean;
  /** test hook: how the person's own Claude Code app (`claude`) is found and run for detection */
  localClaude?: DetectOptions;
  /** test hook: how the person's own Codex app (`codex`) is found and run for detection */
  localCodex?: CodexDetectOptions;
  /** The environment the person's own CLIs get (detection and edits). The app's test switch points it at a throwaway
   * config folder. ANTHROPIC_* and OPENAI_* are always removed. Default: process.env. */
  cliEnv?: () => NodeJS.ProcessEnv;
  /** Electron `safeStorage` (or compatible). Without it (or when it cannot encrypt) secrets are NOT
   * saved, unless allowPlaintextSecrets is set. */
  secretStore?: SecretStore;
  /** Dev CLI only (`--insecure-plaintext`): keep secrets in plain files when no keychain exists. */
  allowPlaintextSecrets?: boolean;
  /** cumulative token brake per edit (default DEFAULT_TOKEN_BUDGET) */
  tokenBudget?: number;
  /** test hook: DNS lookup for the private-host check */
  lookup?: import('./safety').LookupFn;
  promptsDir?: string;
  /** test hooks */
  fetch?: typeof fetch;
  siwcIssuer?: string;
  openaiBaseURL?: string;
  anthropicBaseURL?: string;
  /** Force a specific model provider (tests). */
  /** Tests: the model every role uses, or one per role. */
  providerOverride?: ModelProvider | ((role: ModelRole) => ModelProvider);
  /** The person's model per role (the app's Settings › Editor › Models), read at the start of each job. */
  roleModels?: () => RoleModels | Promise<RoleModels>;
  /** Force the harness a note runs in (tests, the dev CLI). */
  harnessOverride?: Harness;
  checkerHarnessOverride?: Harness;
  finalRender?: boolean;
  maxSteps?: number;
}

// claude-cli = the person's own Claude Code app, offered to everyone. It is never called "Claude Code" on its own:
// Reel Studio is not Claude Code, it uses the Claude Code app the person signed in to themselves.
export const CLAUDE_CODE_LABEL = 'Claude (your Claude Code app)';
// codex-cli = the person's own Codex app (OpenAI's `codex` CLI), signed in with their ChatGPT plan.
export const CODEX_LABEL = 'ChatGPT (your Codex app)';
const LABELS: Record<ProviderId, string> = {
  chatgpt: 'ChatGPT (dev)', claude: 'Claude', 'codex-cli': CODEX_LABEL, 'claude-cli': CLAUDE_CODE_LABEL, custom: 'Your own server', replay: 'Replay (dev)', none: 'No AI',
};
// "Sign in with ChatGPT" (chatgpt, SIWC) is retired for people: ChatGPT goes through the person's own Codex app.
// It stays reachable in dev mode only until siwc.ts is deleted (the release after the one-time sign-out).
const PEOPLE_PROVIDERS: ProviderId[] = ['claude', 'claude-cli', 'codex-cli', 'custom', 'none'];

const LOCAL_CLAUDE_TTL_MS = 60_000;
/** Claude Code's `subscriptionType` as a plan name, with "Claude" dropped: "max" → "Max". */
const CLAUDE_PLAN_NAMES: Record<string, string> = { max: 'Max', max5x: 'Max 5x', max20x: 'Max 20x', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free' };
const claudePlanName = (p: string | undefined): string | undefined => (p ? CLAUDE_PLAN_NAMES[p.toLowerCase().replace(/^claude|subscription$/g, '')] : undefined);
/** Claude Code's model names as the picker shows them, each with the levels its --effort takes. */
const CLAUDE_CODE_PICKS: HubModel[] = CLAUDE_CODE_MODELS.map((m) => ({ id: m, name: `Claude ${m[0].toUpperCase()}${m.slice(1)}`, family: 'claude', efforts: m === 'haiku' ? [] : [...CLAUDE_CODE_EFFORTS], images: true }));

export function createAI(opts: CreateAIOptions) {
  let checking: AbortController | null = null;
  let localCache: { at: number; v: LocalClaude } | null = null;
  async function localClaude(fresh = false): Promise<LocalClaude> {
    if (!fresh && localCache && Date.now() - localCache.at < LOCAL_CLAUDE_TTL_MS) return localCache.v;
    const v = await detectLocalClaude({ env: env(), ...(opts.localClaude ?? {}) });
    localCache = { at: Date.now(), v };
    return v;
  }
  const env = (): NodeJS.ProcessEnv => opts.cliEnv?.() ?? process.env;
  let codexCache: { at: number; v: LocalCodex } | null = null;
  let codexPlan: { bin: string; at: number; plan?: string } | null = null;
  /** Claude Code's windows as its last answer or refusal reported them (it says them only then) */
  let claudeWindows: { at: number; v: import('./types').LimitWindow[] } | null = null;
  async function localCodex(fresh = false): Promise<LocalCodex> {
    if (!fresh && codexCache && Date.now() - codexCache.at < LOCAL_CLAUDE_TTL_MS) return codexCache.v;
    const v = await detectCodex({ env: env(), ...(opts.localCodex ?? {}) });
    codexCache = { at: Date.now(), v };
    return v;
  }
  const settingsFile = path.join(opts.settingsDir, 'ai-settings.json');
  const prompts = new Prompts(opts.promptsDir ?? defaultPromptsDir());
  const style = new StyleStore(() => opts.host.reelStudioRoot());
  const siwc = new SiwcAuth({ settingsDir: opts.settingsDir, secretStore: opts.secretStore, fetch: opts.fetch, issuer: opts.siwcIssuer, allowPlaintextSecrets: opts.allowPlaintextSecrets });
  // One edit at a time per project (the app may double-click; the CLI may race). `owner`: the token of
  // the app job that has the project (owner.ts); without one (the dev CLI) the edit also refuses while
  // the app has the project open.
  const locks = new Map<string, Promise<unknown>>();
  function exclusive<T>(dir: string, owner: string | undefined, fn: () => Promise<T>): Promise<T> {
    const key = path.resolve(dir).toLowerCase();
    const prev = locks.get(key) ?? Promise.resolve();
    // in-process queue, plus a lock FILE every edit holds for its whole run, so two edits in different
    // processes (the app and the dev CLI, or two dev CLIs) never run on one project at once
    const run = prev.catch(() => undefined).then(() => {
      if (!owner) refuseIfOpen(dir);
      return withEditLock(dir, fn);
    });
    // The lock's copy of the run must never reject on its own: the caller gets `run` and handles
    // its error; an unobserved rejected `finally` copy is an unhandled rejection in Node.
    const tail: Promise<unknown> = run.finally(() => { if (locks.get(key) === tail) locks.delete(key); })
      .catch(() => undefined);
    locks.set(key, tail);
    return run;
  }
  const stockSearch = new StockSearch({ settingsDir: opts.settingsDir, key: stockKey, fetchImpl: opts.fetch });
  const deps = (host: EngineHost, owner?: string, stuck?: () => unknown): editor.EditorDeps => ({ host, owner, stuck, prompts, style, stockSearch, fetchImpl: opts.fetch, finalRender: opts.finalRender, maxSteps: opts.maxSteps, tokenBudget: opts.tokenBudget, lookup: opts.lookup });
  function edit<T>(owner: string | undefined, run: (d: editor.EditorDeps) => Promise<T>): Promise<T> {
    const engine = editHost(opts.host, owner);
    return engine.settle(run(deps(engine.host, owner, engine.stuck)));
  }

  async function settings(): Promise<AISettings> {
    try { return JSON.parse(await fsp.readFile(settingsFile, 'utf8')); } catch { return {}; }
  }
  async function saveSettings(patch: Partial<AISettings>): Promise<void> {
    await writeFileAtomic(settingsFile, JSON.stringify({ ...(await settings()), ...patch }, null, 2));
  }

  // ---- secrets: <name>.bin encrypted with the secret store; <name>.txt only for the dev CLI's --insecure-plaintext
  const secretFiles = (name: string) => ({ enc: path.join(opts.settingsDir, `${name}.bin`), plain: path.join(opts.settingsDir, `${name}.txt`) });
  async function readSecret(name: string): Promise<string | null> {
    const f = secretFiles(name);
    try {
      if (fs.existsSync(f.enc) && opts.secretStore) return opts.secretStore.decryptString(await fsp.readFile(f.enc));
      if (opts.allowPlaintextSecrets && fs.existsSync(f.plain)) return (await fsp.readFile(f.plain, 'utf8')).trim() || null;
    } catch { /* unreadable */ }
    return null;
  }
  const hasSecret = (name: string) => { const f = secretFiles(name); return fs.existsSync(f.enc) || (!!opts.allowPlaintextSecrets && fs.existsSync(f.plain)); };
  /** Replaces the secret. The old one stays until the new one is written, so a failed replacement keeps it. */
  async function writeSecret(name: string, value: string | null, noStorageMessage: string): Promise<void> {
    const f = secretFiles(name);
    if (!value) { await fsp.rm(f.enc, { force: true }); await fsp.rm(f.plain, { force: true }); return; }
    // Linux without a keyring: Electron's 'basic_text' encrypts with a password built into Chromium, which protects nothing
    const weak = opts.secretStore?.getSelectedStorageBackend?.() === 'basic_text';
    if (opts.secretStore?.isEncryptionAvailable() && !weak) {
      await writeFileAtomic(f.enc, opts.secretStore.encryptString(value), 0o600);
      await fsp.rm(f.plain, { force: true });
    } else if (opts.allowPlaintextSecrets) {
      await writeFileAtomic(f.plain, value, 0o600);
      await fsp.rm(f.enc, { force: true });
    } else throw new AIError('no_secure_storage', weak ? WEAK_STORE_MESSAGE : noStorageMessage);
  }

  // ---- Claude key (secret)
  const claudeKey = () => readSecret('claude-key');
  const storeClaudeKey = (key: string | null) => writeSecret('claude-key', key, 'This computer has no safe place to keep your Claude key, so it was not saved. Add it from the Reel Studio app.');

  // ---- your own AI server ('custom')
  const connectionSecret = (id: string) => {
    if (!CONNECTION_ID.test(id)) throw new AIError('connection_gone', 'That connection is no longer saved.');
    return `connection-${id}`;
  };
  const managementSecret = (id: string) => `${connectionSecret(id)}-management`;
  const connectionInfo = (c: CustomConnection, s: AISettings): ConnectionInfo => ({
    id: c.id, label: c.label, kind: c.kind, baseURL: c.baseURL, model: c.model, supportsImages: c.supportsImages,
    hasKey: hasSecret(connectionSecret(c.id)), active: s.active === 'custom' && activeConnection(s)?.id === c.id,
    ...(c.keySource ? { keySource: c.keySource } : {}),
    ...(c.kind === 'cliproxy' ? { hasManagementKey: hasSecret(managementSecret(c.id)) } : {}),
  });
  // Connection changes run one at a time: a save that is still checking must not undo a later edit (and leave a
  // key bound to the wrong address).
  let connectionQueue: Promise<unknown> = Promise.resolve();
  function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
    const run = connectionQueue.then(fn, fn);
    connectionQueue = run.catch(() => undefined);
    return run;
  }
  function activeConnection(s: AISettings): CustomConnection | undefined {
    const list = s.connections ?? [];
    return list.find((c) => c.id === s.activeConnection) ?? list[0];
  }
  function connectionProvider(c: CustomConnection, key: string | null, check = false): ModelProvider {
    if (c.kind === 'cliproxy') {
      const p = hubProvider({ origin: c.baseURL, key: key ?? '', choice: c.model, supportsImages: ['claude', 'gpt'].includes(familyOf(splitModel(c.model).model)), fetch: opts.fetch, check });
      return check ? p : withAlternative(p, c);
    }
    if (c.kind === 'anthropic') {
      return new AnthropicProvider({
        id: 'custom', apiKey: key!, model: c.model, baseURL: c.baseURL, fetch: noRedirectFetch(opts.fetch), supportsImages: c.supportsImages,
        ...(check ? { maxRetries: 0, timeoutMs: CHECK_TIMEOUT_MS, maxTokens: 64 } : {}),
      });
    }
    return new OpenAICompatibleProvider({ baseURL: c.baseURL, apiKey: key, model: c.model, fetch: opts.fetch, supportsImages: c.supportsImages, ...(check ? { timeoutMs: CHECK_TIMEOUT_MS } : {}) });
  }
  // The hub's model list, kept a minute: the stage picker, and the other model a limit error offers.
  let hubCache: { key: string; at: number; v: HubModel[] } | null = null;
  async function hubList(c: CustomConnection, key: string | null): Promise<HubModel[]> {
    const k = `${c.baseURL}|${c.id}`;
    if (hubCache && hubCache.key === k && Date.now() - hubCache.at < 60_000) return hubCache.v;
    const v = await hubModels(c.baseURL, key, { fetch: opts.fetch });
    hubCache = { key: k, at: Date.now(), v };
    return v;
  }
  /** A limit on the hub names another model to try: the hub's first model of another family (Claude ↔ ChatGPT),
   * which runs on other accounts. */
  function withAlternative(p: ModelProvider, c: CustomConnection): ModelProvider {
    const complete = p.complete.bind(p);
    return Object.assign(Object.create(Object.getPrototypeOf(p)), p, {
      complete: async (req: Parameters<ModelProvider['complete']>[0]) => {
        try { return await complete(req); } catch (e) {
          if (!(e instanceof AIError) || e.code !== 'connection_limited') throw e;
          const family = familyOf(splitModel(p.model ?? c.model).model);
          const other = (await hubList(c, await readSecret(connectionSecret(c.id))).catch(() => [] as HubModel[]))
            .find((m) => m.family !== family && (m.family === 'claude' || m.family === 'gpt'));
          if (!other) throw e;
          throw new AIError(e.code, `${e.userMessage} ${other.name} runs on your ${other.family === 'claude' ? 'Claude' : 'ChatGPT'} accounts: choose it in Settings, under Editor.`, { detail: e.message, retryable: e.retryable, status: e.status, resetsAt: e.resetsAt });
        }
      },
    }) as ModelProvider;
  }

  /** Throws the plain-words AIError when the server does not answer; returns whether it took a picture. A cut-off
   * reply (connection_truncated) counts as an answer. So does busy or out of quota (connection_busy), which proves
   * the address, key and model are real; the picture is then not tried and counts as refused. */
  async function checkConnection(c: CustomConnection, key: string | null): Promise<boolean> {
    const ask = (content: Part[]) => connectionProvider(c, key, true)
      .complete({ system: 'Reply with exactly the word OK.', messages: [{ role: 'user', content }], tools: [], jsonOnly: true })
      .then(() => 'answered' as const, (e) => {
        if (e instanceof AIError && e.code === 'connection_truncated') return 'answered' as const;
        if (e instanceof AIError && (e.code === 'connection_busy' || e.code === 'connection_limited')) return 'busy' as const;
        throw e;
      });
    if ((await ask([{ type: 'text', text: 'Say OK.' }])) === 'busy') return false;
    return (await ask([{ type: 'text', text: 'Say OK.' }, { type: 'image', mime: 'image/png', base64: PIXEL_PNG }]).catch(() => 'refused')) === 'answered';
  }

  async function stockKey(provider: 'pexels' | 'pixabay'): Promise<string | null> {
    if (!protectedSecretStore(opts.secretStore)) return null;
    try { return opts.secretStore.decryptString(await fsp.readFile(path.join(opts.settingsDir, `${provider}-key.bin`))); }
    catch { return null; }
  }

  function protectedSecretStore(store: SecretStore | undefined): store is SecretStore {
    return !!store && store.isEncryptionAvailable() && store.getSelectedStorageBackend?.() !== 'basic_text';
  }

  async function statusOf(id: ProviderId): Promise<ProviderStatus> {
    const s = await settings();
    switch (id) {
      case 'chatgpt': {
        const sess = await siwc.session();
        if (sess.connected && !sess.planUsage) {
          return { id, connected: false, label: LABELS.chatgpt, detail: sess.email, error: { code: 'chatgpt_plan_not_enabled', userMessage: 'You are signed in, but Reel Studio was not allowed to use your ChatGPT plan. Sign in again and allow it.' } };
        }
        return { id, connected: sess.connected && sess.planUsage, label: LABELS.chatgpt, detail: sess.email };
      }
      case 'claude': return { id, connected: !!(await claudeKey()), label: LABELS.claude, detail: s.claudeModel ?? DEFAULT_CLAUDE_MODEL };
      case 'claude-cli': {
        // detail is the plan kind, else the CLI version: never the account (no e-mail, no organization)
        const lc = await localClaude();
        const plan = claudePlanName(lc.plan);
        return {
          id, connected: lc.state === 'ready', label: LABELS['claude-cli'], ...(plan ? { detail: plan } : lc.version ? { detail: lc.version } : {}),
          ...(lc.state === 'ready' ? {} : { error: { code: `claude_code_${lc.state}`, userMessage: lc.reason ?? 'Your Claude Code app is not ready.' } }),
        };
      }
      case 'custom': {
        const c = activeConnection(s);
        if (!c) return { id, connected: false, label: LABELS.custom };
        const base = { id, label: c.label, detail: c.model, connectionId: c.id };
        const key = await readSecret(connectionSecret(c.id));
        if (!key && hasSecret(connectionSecret(c.id))) {
          return { ...base, connected: false, error: { code: 'connection_key_unreadable', userMessage: `Reel Studio could not read the saved key for ${c.label}. Edit the connection and paste the key again.` } };
        }
        // an Anthropic-compatible server always needs a key (connectionProvider); an OpenAI-compatible one may not
        return { ...base, connected: c.kind === 'openai' || !!key };
      }
      case 'codex-cli': {
        // detail is the CLI version at most: never the account
        const lc = await localCodex();
        return {
          id, connected: lc.state === 'ready', label: LABELS['codex-cli'], ...(lc.version ? { detail: lc.version } : {}),
          ...(lc.state === 'ready' ? {} : { error: { code: `codex_${lc.state}`, userMessage: lc.reason ?? 'Your Codex app is not ready.' } }),
        };
      }
      case 'replay': {
        const f = s.replayFixture ?? process.env.REELSTUDIO_REPLAY;
        return { id, connected: !!(f && fs.existsSync(f)), label: LABELS.replay, detail: f };
      }
      default: return { id: 'none', connected: true, label: LABELS.none };
    }
  }

  async function providers(): Promise<ProviderStatus[]> {
    // claude-cli is always listed, in its real state (the Connect screen shows how to get it ready)
    const custom: ProviderId[] = (await settings()).connections?.length ? ['custom'] : [];
    // the person's own CLIs are always listed, in their real state (the Connect screen shows how to get them ready)
    const ids: ProviderId[] = ['claude', 'claude-cli', 'codex-cli', ...custom, ...(opts.dev ? (['chatgpt', 'replay'] as ProviderId[]) : []), 'none'];
    await Promise.all([localClaude(true), localCodex(true)]);
    return Promise.all(ids.map(statusOf));
  }

  async function active(): Promise<ProviderStatus> {
    const s = await settings();
    if (s.active && s.active !== 'none' && (opts.dev || PEOPLE_PROVIDERS.includes(s.active))) {
      const st = await statusOf(s.active);
      if (st.connected) return st;
    }
    if (s.active === 'none') return statusOf('none');
    // Nothing chosen: an Anthropic API key, if one is saved. Never falls back to claude-cli or codex-cli: they spend
    // the person's own plan, so only their click turns them on.
    for (const id of (opts.dev ? ['claude', 'chatgpt'] : ['claude']) as ProviderId[]) {
      const st = await statusOf(id);
      if (st.connected) return st;
    }
    return statusOf('none');
  }

  async function chatgptModel(): Promise<string> {
    const s = await settings();
    if (s.chatgptModel) return s.chatgptModel;
    const models = await listChatGPTModels(siwc, { baseURL: opts.openaiBaseURL, fetch: opts.fetch });
    if (!models.length) throw new AIError('chatgpt_no_models', 'Your ChatGPT account has no models available for Reel Studio.');
    return models[0].slug;
  }

  const roleChoices = async (): Promise<RoleModels> => (await opts.roleModels?.()) ?? {};

  /** The active editor, asking for `role`'s model. */
  async function modelProvider(role: ModelRole = 'editor'): Promise<ModelProvider | null> {
    if (opts.providerOverride) return typeof opts.providerOverride === 'function' ? opts.providerOverride(role) : opts.providerOverride;
    const st = await active();
    const s = await settings();
    const chosen = modelForRole(st.id, role, await roleChoices());
    switch (st.id) {
      case 'chatgpt': return new OpenAIResponsesProvider({ auth: siwc, model: await chatgptModel(), baseURL: opts.openaiBaseURL, fetch: opts.fetch });
      case 'claude': return new AnthropicProvider({ apiKey: (await claudeKey())!, model: s.claudeModel, baseURL: opts.anthropicBaseURL, fetch: opts.fetch });
      case 'claude-cli': {
        const bin = (await localClaude()).bin;
        // one live `claude` process per run (providers/cli.ts): ~2.5 s less per model turn
        return new ClaudeCliProvider({ ...claudeCodeChoice(chosen ?? s.cliModel), session: true, env: env(), ...(bin ? { bin } : {}) });
      }
      case 'custom':
        // read the address and its key together, never halfway through a save that changes both
        return oneAtATime(async () => {
          const c = activeConnection(await settings());
          if (!c) throw new AIError('no_ai', 'That connection is no longer saved. Pick your editor again in Settings.');
          return connectionProvider(chosen ? { ...c, model: chosen } : c, await readSecret(connectionSecret(c.id)));
        });
      case 'codex-cli': {
        const bin = (await localCodex()).bin;
        return new CodexCliProvider({ ...codexChoice(chosen ?? s.codexModel), env: env(), ...(bin ? { bin } : {}) });
      }
      case 'replay': return new ReplayProvider((s.replayFixture ?? process.env.REELSTUDIO_REPLAY)!);
      default: return null;
    }
  }
  /** The model a version was made with, named as the notes say it: the hub's own name, Claude Code's alias, or a
   * name made from the id, with the reasoning level when one was chosen. */
  async function madeWith(p: ModelProvider | null): Promise<{ model?: string }> {
    if (!p) return {};
    const st = await active();
    const effortName: Record<string, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
    // the stored choice carries the reasoning level; Claude Code's provider holds its level apart from the model
    const choice = modelForRole(st.id, 'editor', await roleChoices());
    const { model, effort } = splitModel(choice ?? p.model ?? (p instanceof ClaudeCliProvider ? 'sonnet' : ''));
    let name: string;
    if (!model) name = st.id === 'codex-cli' ? 'the Codex app’s default model' : st.label;
    else if (st.id === 'claude-cli' && CLAUDE_CODE_MODELS.includes(model)) name = `Claude ${model[0].toUpperCase()}${model.slice(1)}`;
    else name = hubCache?.v.find((m) => m.id === model)?.name ?? nameFromId(model);
    return { model: effort && effortName[effort] ? `${name} · ${effortName[effort]}` : name };
  }
  /** A stored choice for Claude Code: its model and --effort (a level it does not take is left out). */
  function claudeCodeChoice(choice: string | undefined): { model?: string; effort?: string } {
    if (!choice) return {};
    const { model, effort } = splitModel(choice);
    return { model, ...(effort && (CLAUDE_CODE_EFFORTS as readonly string[]).includes(effort) ? { effort } : {}) };
  }
  /** A stored choice for the Codex app: -m and its reasoning level as a config override. */
  function codexChoice(choice: string | undefined): { model?: string; extraArgs?: string[] } {
    if (!choice) return {};
    const { model, effort } = splitModel(choice);
    return { model, ...(effort ? { extraArgs: ['-c', `model_reasoning_effort="${effort}"`] } : {}) };
  }

  async function saveConnection(input: ConnectionInput): Promise<SaveConnectionResult> {
    const fail = (e: unknown): SaveConnectionResult => {
      const err = e instanceof AIError ? e : new AIError('connection_error', 'Something went wrong talking to your server. Try again.', { detail: String((e as any)?.message ?? e) });
      return { status: { id: 'custom', connected: false, label: input.label?.trim() || LABELS.custom, error: err.toJSON() }, error: { ...err.toJSON(), ...(FIELD_OF[err.code] ? { field: FIELD_OF[err.code] } : {}) } };
    };
    const field = (f: ConnectionField, code: string, message: string): SaveConnectionResult => ({ ...fail(new AIError(code, message)), error: { code, userMessage: message, field: f } });
    if (!(input.kind in CONNECTION_KINDS)) return field('address', 'connection_bad_kind', 'Choose the kind of server first.');
    const label = String(input.label ?? '').trim();
    if (!label) return field('label', 'connection_no_label', 'Enter a name for this connection.');
    if (label.length > 60) return field('label', 'connection_no_label', 'Use a shorter name (60 characters at most).');
    const model = String(input.model ?? '').trim();
    if (!model) return field('model', 'connection_no_model', 'Enter a model name.');
    let baseURL: string;
    try { baseURL = normalizeBaseURL(String(input.baseURL ?? '')); } catch (e) { return fail(e); }

    const s = await settings();
    const before = input.id ? s.connections?.find((c) => c.id === input.id) : undefined;
    if (input.id && !before) return fail(new AIError('connection_gone', 'That connection is no longer saved.'));
    const id = before?.id ?? `c_${randomBytes(4).toString('hex')}`;
    const secret = connectionSecret(id);
    const typed = typeof input.key === 'string' ? input.key.trim() : '';
    if (!typed && before && hasSecret(secret) && !sameOrigin(before.baseURL, baseURL)) {
      return field('key', 'connection_key_new_address', 'The server address changed, so paste the key again. A saved key is only sent to the server it was saved for.');
    }
    const key = typed || (before ? await readSecret(secret) : null);
    if (input.kind === 'anthropic' && !key) {
      return field('key', 'connection_no_key', 'Paste the key for this server. Anthropic-compatible servers always need one.');
    }
    const conn: CustomConnection = { id, label, kind: input.kind, baseURL, model, supportsImages: false };
    try { conn.supportsImages = await checkConnection(conn, key); } catch (e) { return fail(e); }
    if (typed) {
      try { await writeSecret(secret, key, 'This computer has no safe place to keep that key, so it was not saved.'); } catch (e) { return fail(e); }
    }
    const list = (s.connections ?? []).filter((c) => c.id !== id);
    const at = before ? (s.connections ?? []).findIndex((c) => c.id === id) : list.length;
    list.splice(at, 0, conn);
    await saveSettings({ connections: list, active: 'custom', activeConnection: id });
    return { status: await statusOf('custom'), connection: connectionInfo(conn, await settings()) };
  }
  async function removeConnection(id: string): Promise<void> {
    const secret = connectionSecret(id);
    const s = await settings();
    const list = (s.connections ?? []).filter((c) => c.id !== id);
    const wasActive = s.active === 'custom' && activeConnection(s)?.id === id;
    await writeSecret(secret, null, '');
    await saveSettings({
      connections: list.length ? list : undefined,
      ...(s.activeConnection === id ? { activeConnection: undefined } : {}),
      ...(wasActive ? { active: undefined } : {}),
    });
  }
  async function connectionModels(q: { kind: ConnectionKind; baseURL: string; key?: string; id?: string }): Promise<ConnectionModels> {
    if (!(q.kind in CONNECTION_KINDS)) return { models: [], suggested: null, needsKey: false };
    // a saved key only goes to the origin it was saved for; a different path on that server may use it
    const saved = q.id ? (await settings()).connections?.find((c) => c.id === q.id) : undefined;
    const key = q.key?.trim() || (saved && sameOrigin(saved.baseURL, q.baseURL) ? await readSecret(connectionSecret(saved.id)) : null);
    const { models, keyRefused } = await listConnectionModels(q.kind, q.baseURL, key, { fetch: opts.fetch }).catch(() => ({ models: [], keyRefused: false }));
    return { models, suggested: suggestedModel(models), needsKey: q.kind === 'anthropic' || keyRefused };
  }
  /** The active connection's own small model, or null when it has none. Never another provider or
   * account: a ChatGPT sign-in has no small model here, so it gets none. */
  async function smallModel(): Promise<ModelProvider | null> {
    const st = await active();
    // a model the person chose for naming versions; Auto keeps the connection's own small model
    if (modelForRole(st.id, 'namer', await roleChoices())) return modelProvider('namer');
    switch (st.id) {
      case 'claude': return new AnthropicProvider({ apiKey: (await claudeKey())!, model: SMALL_CLAUDE_MODEL, maxTokens: 2000, baseURL: opts.anthropicBaseURL, fetch: opts.fetch });
      case 'claude-cli': {
        const bin = (await localClaude()).bin;
        return new ClaudeCliProvider({ model: 'haiku', env: env(), ...(bin ? { bin } : {}) });
      }
      default: return null;
    }
  }

  /** What runs a note's AI turns: Claude Code or Codex over MCP behind the dev setting, else our own loop (undefined). */
  const sessionHarnesses = new Map<string, Harness>();
  async function noteHarness(provider: ModelProvider | null): Promise<Harness | undefined> {
    if (opts.harnessOverride) return opts.harnessOverride;
    if (!opts.dev || opts.providerOverride || !provider) return undefined;
    const s = await settings();
    const id = (await active()).id;
    if (!((s.harness === 'claude-code' && id === 'claude-cli') || (s.harness === 'codex' && id === 'codex-cli'))) return undefined;
    // one way to find each CLI: localClaude.ts and localCodex.ts, as the editor itself uses
    const bin = s.harness === 'claude-code' ? (await localClaude()).bin : (await localCodex()).bin;
    const key = JSON.stringify([s.harness, bin, s.cliModel]);
    let harness = sessionHarnesses.get(key);
    if (!harness) {
      const o = { model: s.cliModel, env: env(), ...(bin ? { bin } : {}) };
      const native = s.harness === 'codex' ? new CodexHarness(o) : new ClaudeCodeHarness(o);
      harness = new SessionHarness(native, () => s.harness === 'codex'
        ? new CodexCliProvider(o)
        : new ClaudeCliProvider({ ...o, session: true }));
      sessionHarnesses.set(key, harness);
    }
    return harness;
  }

  async function checkerHarness(editorHarness: Harness | undefined): Promise<Harness | undefined> {
    if (opts.checkerHarnessOverride) return opts.checkerHarnessOverride;
    if (!opts.dev) return undefined;
    if (editorHarness?.id === 'claude-code') {
      const bin = (await localCodex()).bin;
      return new CodexHarness({ env: env(), ...(bin ? { bin } : {}) });
    }
    if (editorHarness?.id === 'codex') {
      const bin = (await localClaude()).bin;
      return new ClaudeCodeHarness({ env: env(), ...(bin ? { bin } : {}) });
    }
    return undefined;
  }

  return {
    providers,
    active,
    async setActive(id: ProviderId, connectionId?: string): Promise<void> {
      if (id === 'custom') {
        const s = await settings();
        const c = connectionId ? s.connections?.find((x) => x.id === connectionId) : activeConnection(s);
        if (!c) throw new AIError('not_available', 'That connection is no longer saved.');
        await saveSettings({ active: 'custom', activeConnection: c.id });
        return;
      }
      if (id === 'claude-cli') {
        // cancelCheck stops all of it: looking for the app, the check call, and the save after them
        checking?.abort();
        const check = (checking = new AbortController());
        const stopped = (): void => { if (check.signal.aborted) throw new AIError('cancelled', 'Stopped.'); };
        try {
          const lc = await localClaude(true);
          stopped();
          if (lc.state !== 'ready') throw new AIError('not_available', lc.reason ?? 'Your Claude Code app is not ready.');
          // signed in is not the same as able to answer (a plan at its limit, a broken install): one tiny real call
          const s = await settings();
          const model = modelForRole('claude-cli', 'editor', await roleChoices()) ?? s.cliModel;
          try {
            const r = await new ClaudeCliProvider({ ...claudeCodeChoice(model), timeoutMs: CHECK_TIMEOUT_MS, env: env(), ...(lc.bin ? { bin: lc.bin } : {}) })
              .complete({ system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with the word OK.' }] }], tools: [], jsonOnly: true, signal: check.signal });
            if (r.limits) claudeWindows = { at: Date.now(), v: r.limits };
          } catch (e) {
            if (e instanceof AIError && e.limits) claudeWindows = { at: Date.now(), v: e.limits };
            throw e;
          }
          stopped();
          await saveSettings({ active: id, chatgptMoved: undefined });
        } finally {
          if (checking === check) checking = null;
        }
        return;
      } else if (id === 'codex-cli') {
        const lc = await localCodex(true);
        if (lc.state !== 'ready') throw new AIError('not_available', lc.reason ?? 'Your Codex app is not ready.');
        await saveSettings({ active: id, chatgptMoved: undefined });
        return;
      } else if (!opts.dev && !PEOPLE_PROVIDERS.includes(id)) {
        throw new AIError('not_available', 'That option is not available.');
      }
      await saveSettings({ active: id });
    },
    async signInChatGPT(openExternal: (url: string) => Promise<void>): Promise<ProviderStatus> {
      try {
        const sess = await siwc.signIn(openExternal);
        if (sess.planUsage) await saveSettings({ active: 'chatgpt' });
      } catch (e: any) {
        if (e instanceof AIError) return { id: 'chatgpt', connected: false, label: LABELS.chatgpt, error: e.toJSON() };
        throw e;
      }
      return statusOf('chatgpt');
    },
    cancelSignInChatGPT(): void { siwc.cancelSignIn(); },
    /** Stops the check call setActive('claude-cli') is making; setActive then throws AIError 'cancelled' and saves nothing. */
    cancelCheck(): void { checking?.abort(); },
    /** A fresh look at the person's own Claude Code app: state, version, plan kind and the binary path (for the
     * app's sign-in window). Never an e-mail, organization or token. */
    async claudeCodeStatus(): Promise<LocalClaude> { return localClaude(true); },
    /** A fresh look at the person's own Codex app: state, version, kind of sign-in and the binary path (for the app's
     * sign-in). Never an e-mail, a key or a token. `chatgptMoved`: the old in-app sign-in was retired on upgrade. */
    async codexStatus(): Promise<LocalCodex & { chatgptMoved?: boolean; plan?: string }> {
      const v = await localCodex(true);
      // the plan, asked of the Codex app itself (app-server), kept a minute: the row reads "Codex app · Pro"
      let plan: string | undefined;
      if (v.state === 'ready' && v.bin) {
        if (!codexPlan || codexPlan.bin !== v.bin || Date.now() - codexPlan.at > LOCAL_CLAUDE_TTL_MS) codexPlan = { bin: v.bin, at: Date.now(), plan: (await readCodexAccount(v.bin, env()))?.plan };
        plan = codexPlan.plan;
      }
      return { ...v, ...(plan ? { plan } : {}), ...((await settings()).chatgptMoved ? { chatgptMoved: true } : {}) };
    },
    /** Once, at start-up: "Sign in with ChatGPT" is retired. A saved session is signed out (the renewable token revoked,
     * the files deleted) and a choice of it cleared. Returns true when there was something to retire. */
    async retireSignInWithChatGPT(): Promise<boolean> {
      const s = await settings();
      const files = ['chatgpt-credentials.bin', 'chatgpt-credentials.json'].some((f) => fs.existsSync(path.join(opts.settingsDir, f)));
      if (!files && s.active !== 'chatgpt') return false;
      if (files) await siwc.signOut().catch(() => undefined);
      await saveSettings({ ...(s.active === 'chatgpt' ? { active: undefined } : {}), chatgptMoved: true });
      return true;
    },
    async signOutChatGPT(): Promise<void> {
      await siwc.signOut();
      const s = await settings();
      if (s.active === 'chatgpt') await saveSettings({ active: undefined });
    },
    async stockProviders(): Promise<{ id: StockProvider; connected: boolean }[]> {
      return [{ id: 'pexels', connected: !!await stockKey('pexels') }, { id: 'pixabay', connected: !!await stockKey('pixabay') }, { id: 'openverse', connected: true }];
    },
    async setStockKey(provider: 'pexels' | 'pixabay', key: string | null): Promise<void> {
      if (!['pexels', 'pixabay'].includes(provider) || (key !== null && typeof key !== 'string')) throw new AIError('bad_stock_key', 'Choose Pexels or Pixabay and enter an API key.');
      const file = path.join(opts.settingsDir, `${provider}-key.bin`);
      const trimmed = key?.trim();
      if (!trimmed) { await fsp.rm(file, { force: true }); return; }
      if (!protectedSecretStore(opts.secretStore)) throw new AIError('no_secure_storage', 'This computer does not have a protected password store, so the stock API key was not saved.');
      try { await writeFileAtomic(file, opts.secretStore.encryptString(trimmed), 0o600); }
      catch { throw new AIError('stock_key_save_failed', 'The stock API key could not be saved securely. Try again.'); }
    },
    async setClaudeKey(key: string | null): Promise<ProviderStatus> {
      const trimmed = key?.trim() || null;
      if (!trimmed) {
        await storeClaudeKey(null);
        const s = await settings();
        if (s.active === 'claude') await saveSettings({ active: undefined });
        return statusOf('claude');
      }
      const s = await settings();
      try {
        await new AnthropicProvider({ apiKey: trimmed, model: s.claudeModel, baseURL: opts.anthropicBaseURL, fetch: opts.fetch }).ping();
      } catch (e: any) {
        const err = e instanceof AIError ? e : new AIError('claude_error', 'Reel Studio could not check that key. Try again.');
        // Rate-limited / overloaded still proves the key is real: keep it.
        if (!['claude_rate_limited', 'claude_unavailable'].includes(err.code)) return { id: 'claude', connected: false, label: LABELS.claude, error: err.toJSON() };
      }
      try { await storeClaudeKey(trimmed); } catch (e: any) {
        if (e instanceof AIError) return { id: 'claude', connected: false, label: LABELS.claude, error: e.toJSON() };
        throw e;
      }
      await saveSettings({ active: 'claude' });
      return statusOf('claude');
    },
    async connections(): Promise<ConnectionInfo[]> {
      const s = await settings();
      return (s.connections ?? []).map((c) => connectionInfo(c, s));
    },
    /** Saved and used only after one small request through it works; otherwise `error` names the field to fix. */
    saveConnection(input: ConnectionInput): Promise<SaveConnectionResult> {
      return oneAtATime(() => saveConnection(input));
    },
    removeConnection(id: string): Promise<void> {
      return oneAtATime(() => removeConnection(id));
    },
    setConnectionImages(id: string, supportsImages: boolean): Promise<void> {
      return oneAtATime(async () => {
        const s = await settings();
        if (!s.connections?.some((c) => c.id === id)) throw new AIError('connection_gone', 'That connection is no longer saved.');
        await saveSettings({ connections: s.connections.map((c) => (c.id === id ? { ...c, supportsImages } : c)) });
      });
    },
    /** `key` empty with `id` set uses that connection's stored key, which never leaves this process. */
    connectionModels(q: { kind: ConnectionKind; baseURL: string; key?: string; id?: string }): Promise<ConnectionModels> {
      return oneAtATime(() => connectionModels(q));
    },
    async setModel(which: 'claude' | 'chatgpt' | 'cli', model: string | null): Promise<void> {
      await saveSettings({ [`${which}Model`]: model ?? undefined } as Partial<AISettings>);
    },
    async chatgptModels(): Promise<{ slug: string; displayName: string }[]> {
      return listChatGPTModels(siwc, { baseURL: opts.openaiBaseURL, fetch: opts.fetch });
    },
    async setReplayFixture(file: string | null): Promise<void> { await saveSettings({ replayFixture: file ?? undefined }); },
    /** One tiny request through the active editor with `role`'s model (the editor's Test): its reply, the model that
     * answered and how long it took. Throws AIError with a userMessage. */
    async testConnection(signal?: AbortSignal, role: ModelRole = 'editor'): Promise<TestResult> {
      const p = await modelProvider(role);
      if (!p) throw new AIError('no_ai', 'No editor is connected yet. Choose one in Settings, under Editor.');
      const t0 = Date.now();
      try {
        const r = await p.complete({ system: 'Reply with exactly the word OK.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Say OK.' }] }], tools: [], jsonOnly: true, signal });
        if (r.limits) claudeWindows = { at: Date.now(), v: r.limits };
        return { provider: p.id, model: p.model, reply: r.text.trim().slice(0, 200), ms: Date.now() - t0, ...(r.limits ? { limits: r.limits } : {}) };
      } catch (e) {
        if (e instanceof AIError && e.limits) claudeWindows = { at: Date.now(), v: e.limits };
        throw e;
      } finally {
        await (p as { dispose?: () => Promise<void> }).dispose?.();
      }
    },
    /** The models the editor in use offers, for each stage's picker: the hub's list, Claude Code's names, the Codex
     * app's list, or your own server's. Empty for an editor that picks its own (a Claude key). */
    async editorModels(): Promise<EditorModel[]> {
      const st = await active();
      if (st.id === 'claude-cli') return CLAUDE_CODE_PICKS;
      if (st.id === 'codex-cli') {
        const bin = (await localCodex()).bin;
        return bin ? ((await readCodexAccount(bin, env()))?.models ?? []) : [];
      }
      if (st.id !== 'custom') return [];
      const c = activeConnection(await settings());
      if (!c) return [];
      const key = await readSecret(connectionSecret(c.id));
      if (c.kind === 'cliproxy') return hubList(c, key);
      const { models } = await listConnectionModels(c.kind, c.baseURL, key, { fetch: opts.fetch }).catch(() => ({ models: [] as string[] }));
      return models.map((id) => ({ id, name: nameFromId(id), family: familyOf(id), efforts: [], images: c.supportsImages }));
    },
    /** Who the editor in use runs as: CLIProxyAPI's accounts (with its management key), the Codex app's plan and
     * limits, or Claude Code's plan with the windows its last answer reported. Never an e-mail for the person's own
     * apps; a hub account is named by the e-mail the hub has for it. */
    async editorAccounts(): Promise<EditorAccounts> {
      const st = await active();
      if (st.id === 'claude-cli') {
        const lc = await localClaude();
        const plan = claudePlanName(lc.plan);
        return { accounts: [{ name: 'Claude Code app', provider: 'claude', ...(plan ? { plan } : {}), windows: claudeWindows?.v ?? [] }] };
      }
      if (st.id === 'codex-cli') {
        const bin = (await localCodex()).bin;
        const a = bin ? await readCodexAccount(bin, env()) : null;
        if (!a) return { accounts: [], problem: 'Your Codex app didn’t say its plan or limits. Update it, then look again.' };
        return { accounts: [{ name: 'Codex app', provider: 'codex', ...(a.plan ? { plan: a.plan } : {}), windows: a.windows }] };
      }
      if (st.id !== 'custom') return { accounts: [] };
      const c = activeConnection(await settings());
      if (!c || c.kind !== 'cliproxy') return { accounts: [] };
      const mk = await readSecret(managementSecret(c.id));
      if (!mk) return { accounts: [], needsManagementKey: true };
      try {
        const list: HubAccount[] = await hubAccounts(c.baseURL, mk, { fetch: opts.fetch });
        return { accounts: list.map(({ id: _id, ...a }) => a) };
      } catch (e) {
        if (e instanceof AIError && e.code === 'hub_management_key') return { accounts: [], needsManagementKey: true, problem: e.userMessage };
        return { accounts: [], problem: e instanceof AIError ? e.userMessage : 'CLIProxyAPI could not list its accounts.' };
      }
    },
    /**
     * Connects CLIProxyAPI at `origin` with `key` (read by the app from the hub's own config, or typed) and makes it the
     * editor. Saved only after its model list answers with that key; the key goes to the encrypted connection store.
     * `keySource` is said in the row. A hub saved before at the same origin is updated, not duplicated.
     */
    saveHub(input: { origin: string; key: string; keySource: string }): Promise<SaveConnectionResult> {
      return oneAtATime(async () => {
        const fail = (e: unknown): SaveConnectionResult => {
          const err = e instanceof AIError ? e : new AIError('hub_error', 'Something went wrong talking to CLIProxyAPI. Try again.', { detail: String((e as any)?.message ?? e) });
          return { status: { id: 'custom', connected: false, label: 'CLIProxyAPI', error: err.toJSON() }, error: { ...err.toJSON(), field: 'key' } };
        };
        let origin: string;
        try { origin = new URL(normalizeBaseURL(input.origin)).origin; } catch (e) { return fail(e); }
        const key = String(input.key ?? '').trim();
        if (!key) return fail(new AIError('hub_key', 'Paste a key from api-keys in your CLIProxyAPI config.'));
        let models: HubModel[];
        try { models = await hubModels(origin, key, { fetch: opts.fetch }); } catch (e) { return fail(e); }
        const s = await settings();
        const before = (s.connections ?? []).find((c) => c.kind === 'cliproxy' && sameOrigin(c.baseURL, origin));
        const id = before?.id ?? `c_${randomBytes(4).toString('hex')}`;
        const ids = models.map((m) => m.id);
        const model = (before && ids.includes(splitModel(before.model).model) ? before.model : null) ?? suggestedModel(ids) ?? models.find((m) => m.family === 'claude')?.id ?? ids[0];
        if (!model) return fail(new AIError('hub_no_models', 'CLIProxyAPI answered, but it offers no models yet. Sign in an account in CLIProxyAPI, then look again.'));
        try { await writeSecret(connectionSecret(id), key, 'This computer has no safe place to keep that key, so it was not saved.'); } catch (e) { return fail(e); }
        const conn: CustomConnection = { id, label: 'CLIProxyAPI', kind: 'cliproxy', baseURL: origin, model, supportsImages: true, keySource: String(input.keySource ?? '').slice(0, 300) || 'typed' };
        const list = (s.connections ?? []).filter((c) => c.id !== id);
        list.unshift(conn);
        await saveSettings({ connections: list, active: 'custom', activeConnection: id });
        hubCache = { key: `${origin}|${id}`, at: Date.now(), v: models };
        return { status: await statusOf('custom'), connection: connectionInfo(conn, await settings()) };
      });
    },
    /** CLIProxyAPI's management key, for its accounts and limits. Saved only after the hub accepts it; null removes it. */
    setHubManagementKey(key: string | null): Promise<EditorAccounts> {
      return oneAtATime(async () => {
        const c = activeConnection(await settings());
        if (!c || c.kind !== 'cliproxy') throw new AIError('connection_gone', 'Connect CLIProxyAPI first.');
        const k = key?.trim() || null;
        if (!k) { await writeSecret(managementSecret(c.id), null, ''); return { accounts: [], needsManagementKey: true }; }
        const list = await hubAccounts(c.baseURL, k, { fetch: opts.fetch });
        await writeSecret(managementSecret(c.id), k, 'This computer has no safe place to keep that key, so it was not saved.');
        return { accounts: list.map(({ id: _id, ...a }) => a) };
      });
    },
    /** `opts.pauseOn`: an AI failure the app pauses on (editor.ts EditorDeps.pauseOn) instead of a basic version. */
    async firstEdit(projectDir: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal, opts: { owner?: string; basic?: boolean; pauseOn?: (e: AIError) => boolean } = {}): Promise<AgentResult & { notice?: any }> {
      return exclusive(projectDir, opts.owner, () => edit(opts.owner, async (d) => {
        if (opts.basic) return editor.firstEdit(d, null, projectDir, onEvent, signal);
        // each role asks for its own model (Settings › Editor › Models)
        const roles = { checker: await modelProvider('checker'), writer: await modelProvider('writer') };
        const provider = await modelProvider('editor');
        const r = await editor.firstEdit({ ...d, ...roles, pauseOn: opts.pauseOn }, provider, projectDir, onEvent, signal);
        // a notice means the editor stopped and the simple edit made the version: no model made it
        return r.notice ? r : { ...r, ...(await madeWith(provider)) };
      }));
    },
    async applyNote(projectDir: string, note: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal, opts: editor.ApplyNoteOptions & { owner?: string } = {}): Promise<AgentResult> {
      return exclusive(projectDir, opts.owner, () => edit(opts.owner, async (d) => {
        const provider = await modelProvider();
        const harness = await noteHarness(provider);
        // "Double-check each edit": in our own loop the checker role's model reviews (#73); a note in an MCP harness
        // is reviewed by the other harness (mcp-harness-2)
        const checker = !opts.checkEdit ? {} : harness ? { checkerHarness: await checkerHarness(harness) } : { checker: await modelProvider('checker') };
        const r = await editor.applyNote({ ...d, ...checker, harness }, provider, projectDir, note, onEvent, signal, opts);
        return r.version !== undefined && r.changed.length ? { ...r, ...(await madeWith(provider)) } : r;
      }));
    },
    /** True when applyNote would take the no-model fast path for these words ("smaller captions"):
     * a setting for the whole reel. The app asks before adding a moment, which would hide it. */
    async wholeReelSetting(projectDir: string, note: string): Promise<boolean> {
      return !!planFastNote(note, await loadProject(projectDir));
    },
    async mergeVersions(projectDir: string, request: import('./version-merge').MergeRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal, opts: { owner?: string; id?: string } = {}): Promise<editor.MergeEditResult> {
      return exclusive(projectDir, opts.owner, () => edit(opts.owner, (d) => editor.saveMerge(d, projectDir, request, onEvent, signal, opts)));
    },
    async writeScript(idea: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<ScriptResult> {
      return editor.writeScript(deps(opts.host), await modelProvider('writer'), idea, onEvent, signal);
    },
    /** Rewords a committed version's title and summary with one small-model call. null: the connection
     * has no small model, or the reply was not the JSON asked for. The app checks the words against the
     * version's receipts before it shows them. */
    async rewordVersion(text: { title: string; summary: string }, signal?: AbortSignal): Promise<{ title: string; summary: string } | null> {
      const p = await smallModel();
      if (!p) return null;
      const r = await p.complete({ system: prompts.render('versionTitle'), messages: [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(text) }] }], tools: [], jsonOnly: true, signal });
      const j = extractJson(r.text);
      return typeof j?.title === 'string' && typeof j?.summary === 'string' ? { title: j.title, summary: j.summary } : null;
    },
    /** One turn of a planned reel's planning chat: a short question back, or the whole plan (editor.ts planTurn). */
    async planTurn(input: PlanTurnInput, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<PlanTurnResult> {
      return editor.planTurn(deps(opts.host), await modelProvider('planner'), input, onEvent, signal);
    },
    /** Try 2 for a trial post: the one thing the editor changes from the reel as it is, and why. */
    async proposeTry(req: TryRequest, signal?: AbortSignal): Promise<TryProposal> {
      return proposeTry(prompts, await modelProvider('trial'), req, signal);
    },
    /** More reels from one video: the distinct reels the editor finds in its transcript, best first (propose.ts). */
    async proposeReels(req: ProposeReelsRequest, signal?: AbortSignal, onEvent?: (e: AgentEvent) => void): Promise<ReelProposal> {
      return proposeReels(prompts, await modelProvider('finder'), req, signal, onEvent);
    },
    async styleRules() { return style.list(); },
    async removeStyleRule(id: string, options?: { forget?: boolean }) { return style.remove(id, options); },
    /** The user said Yes to a proposed rule (AgentResult.styleSuggestions), typed one in My style, or kept one
     * learned from an export. `from`: the note or the export it came from. Returns the saved rule. */
    async addStyleRule(text: string, from?: Pick<StyleRule, 'source' | 'imported' | 'byYou'>) { return (await style.add(text, from)).rule; },
    /** Undo of removeStyleRule: the rule back at `index`. */
    async restoreStyleRule(rule: StyleRule, index: number) { return style.restore(rule, index); },
    /** My style started over because its file was damaged; the damaged copy is kept next to it. */
    async styleWasDamaged() { return style.wasDamaged(); },
    /** The user said Yes to AgentResult.styleProposal. */
    async approveStyleProposal(p: StyleProposal) { return style.approve(p); },
    /** The user said No to AgentResult.styleProposal. */
    async declineStyleProposal(p: StyleProposal) { return style.decline(p); },
    /** My style: the user edited a rule's words, or paused or resumed it. */
    async updateStyleRule(id: string, patch: { text?: string; paused?: boolean }) { return style.update(id, patch); },
  };
}

export type ReelStudioAI = ReturnType<typeof createAI>;

/** The engine as one edit sees it. An app job's `owner` token goes on every command
 * (engine/reelengine/owner.py). Once part of an engine would not stop (ENGINE_STUCK) no further
 * command runs, and `settle` fails the edit with that error however it ended: a first look or a tool
 * result would otherwise swallow it, and the app job would let go of the project while that part may
 * still be writing to it. */
function editHost(host: EngineHost, owner: string | undefined) {
  let stuck: unknown = null;
  return {
    host: {
      async runEngine(command, args, onProgress, signal) {
        if (stuck) throw stuck;
        try {
          return await host.runEngine(command, owner ? [...args, '--owner', owner] : args, onProgress, signal);
        } catch (e: any) {
          if (e?.code === 'ENGINE_STUCK') stuck ??= e;
          throw e;
        }
      },
      renderAnimation: (template, params, outPath) => host.renderAnimation(template, params, outPath),
      reelStudioRoot: () => host.reelStudioRoot(),
      ...(host.captureWebsite ? { captureWebsite: host.captureWebsite.bind(host) } : {}),
    } satisfies EngineHost,
    stuck: () => stuck,
    async settle<T>(edit: Promise<T>): Promise<T> {
      const r = await edit.catch((e) => { throw stuck ?? e; });
      if (stuck) throw stuck;
      return r;
    },
  };
}

const LOCK_STALE_MS = 3 * 60 * 60 * 1000;

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
}

/** <project>/work/.ai-edit.lock holds {pid, at}. Another LIVE process holding it = AIError busy; a
 * dead or 3-hour-old holder is taken over. */
export async function withEditLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = path.join(dir, 'work', '.ai-edit.lock');
  await fsp.mkdir(path.dirname(lock), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const fh = await fsp.open(lock, 'wx');
      await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
      await fh.close();
      break;
    } catch (e: any) {
      if (e?.code !== 'EEXIST' || attempt > 0) {
        if (e?.code === 'EEXIST') throw new AIError('busy', 'This video is being edited somewhere else right now. Try again when that finishes.');
        throw e;
      }
      let held: { pid?: number; at?: number } = {};
      try { held = JSON.parse(await fsp.readFile(lock, 'utf8')); } catch { /* unreadable = stale */ }
      const live = held.pid && held.pid !== process.pid && alive(held.pid) && Date.now() - (held.at ?? 0) < LOCK_STALE_MS;
      if (live) throw new AIError('busy', 'This video is being edited somewhere else right now. Try again when that finishes.');
      await fsp.rm(lock, { force: true });
    }
  }
  try { return await fn(); } finally { await fsp.rm(lock, { force: true }).catch(() => undefined); }
}
export { PythonEngineHost, defaultRoot } from './engineHost';
