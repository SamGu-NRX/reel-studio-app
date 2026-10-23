// Mirror of the @reelstudio/ai interface (docs/architecture.md section 8). The real package is loaded at
// runtime when it exists; until then ai-mock.ts implements the same shape.
import type { JobUpdate, StyleProposal, StyleRule } from '../shared/api'
import type { TryVariable } from '../shared/platforms'

/** What @reelstudio/ai emits: the job contract minus `heard` (main adds that one itself). */
export type AgentEvent = Exclude<JobUpdate, { type: 'heard' }>

export interface UserFacingError {
  code: string
  userMessage: string
  link?: string
}

export interface AgentResult {
  summary: string
  version: number
  styleRulesAdded: string[]
  changed: string[]
  /** Rules the AI PROPOSES for My style, not saved (stream quality2). The app asks before saving. */
  styleSuggestions?: string[]
  /** A typed rule to ask about; Yes = approveStyleProposal(it). */
  styleProposal?: StyleProposal
  /** Set when the AI stopped early and a simpler edit was made instead. */
  notice?: UserFacingError
}

export interface ScriptResult {
  hook: string
  script: string
  onScreenText: string[]
  title?: string
}

/** What the editor reads to choose Try 2 (ai/src/trial.ts). */
export interface TryRequest {
  /** Try 1's caption as posted; its first line is the hook line. */
  caption: string
  duration: number
  /** What is said, on the finished reel's clock. */
  words: { w: string; s: number }[]
  coverSeconds: number | null
  /** The creator swapped to this one. */
  variable?: TryVariable
}

export interface EngineHost {
  runEngine(
    command: string,
    args: string[],
    onProgress?: (p: { stage: string; pct: number; message: string }) => void,
    signal?: AbortSignal
  ): Promise<any>
  renderAnimation(template: string, params: Record<string, unknown>, outPath: string, fps?: number): Promise<string>
  reelStudioRoot(): string
  captureWebsite?(
    url: string,
    outPath: string,
    opts?: { layout?: 'phone' | 'desktop' }
  ): Promise<{ path: string; url: string; site: string; title: string; width: number; height: number }>
}

export interface ProviderStatus {
  id: 'chatgpt' | 'claude' | 'codex-cli' | 'claude-cli' | 'custom' | 'replay' | 'none'
  connected: boolean
  label: string
  detail?: string
  error?: UserFacingError
  connectionId?: string
}

export interface ConnectionInfo {
  id: string
  label: string
  kind: 'anthropic' | 'openai'
  baseURL: string
  model: string
  supportsImages: boolean
  hasKey: boolean
  active: boolean
}

export interface ConnectionInput {
  id?: string
  label: string
  kind: 'anthropic' | 'openai'
  baseURL: string
  model: string
  /** empty keeps the stored key when editing */
  key?: string
}

export interface SaveConnectionResult {
  status: ProviderStatus
  connection?: ConnectionInfo
  error?: UserFacingError & { field?: 'label' | 'address' | 'key' | 'model' }
}

/** Mirrors Electron's safeStorage. */
export interface SecretStore {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
  getSelectedStorageBackend?(): string
}

export interface AI {
  providers(): Promise<ProviderStatus[]>
  active(): Promise<ProviderStatus>
  setActive(id: ProviderStatus['id'], connectionId?: string): Promise<void>
  signInChatGPT(openExternal: (url: string) => Promise<void>): Promise<ProviderStatus>
  signOutChatGPT(): Promise<void>
  setClaudeKey(key: string | null): Promise<ProviderStatus>
  /** `opts.basic`: the simple edit without a model, whatever editor is connected. */
  /** `opts.pauseOn`: an AI failure the app pauses on (a plan at its limit, no internet), thrown instead of a basic version. */
  firstEdit(
    projectDir: string,
    onEvent: (e: AgentEvent) => void,
    signal?: AbortSignal,
    opts?: { owner?: string; basic?: boolean; pauseOn?: (e: { code: string; resetsAt?: string }) => boolean }
  ): Promise<AgentResult>
  /** `opts.attachments`: `work/assets/attach-*` refs main already checked (the AI checks them again).
   * `opts.id`: the job id the note is saved under. `opts.saveStyleRules: false`: return rules, the app asks.
   * `opts.owner`: the job's owner token, which the note joins instead of taking the project. */
  applyNote(
    projectDir: string,
    note: string,
    onEvent: (e: AgentEvent) => void,
    signal?: AbortSignal,
    opts?: { attachments?: string[]; id?: string; saveStyleRules?: boolean; owner?: string }
  ): Promise<AgentResult>
  /** The words are a whole-reel setting applyNote does without the model ("smaller captions"). */
  wholeReelSetting(projectDir: string, note: string): Promise<boolean>
  writeScript(idea: string, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<ScriptResult>
  /** Try 2 for a trial post: the one thing the editor changes, and its reason in its own voice. Optional: older packages lack it. */
  proposeTry?(req: TryRequest, signal?: AbortSignal): Promise<{ variable: unknown; value: unknown; reason: unknown }>
  styleRules(): Promise<StyleRule[]>
  /** The removed rule and where it was, for Undo; null when it was already gone. */
  removeStyleRule(id: string): Promise<{ rule: StyleRule; index: number } | null>
  /** Saves one My style rule (after the user said Yes, typed in My style, or learned from an export). Optional: older packages lack it. */
  addStyleRule?(text: string, from?: Pick<StyleRule, 'source' | 'imported'>): Promise<StyleRule>
  /** Undo of removeStyleRule. */
  restoreStyleRule?(rule: StyleRule, index: number): Promise<void>
  /** Saves a typed rule the user said Yes to. `exists`: already in My style; `forgotten`: they removed it since. */
  approveStyleProposal?(p: StyleProposal): Promise<{ status: 'saved' | 'exists' | 'forgotten' }>
  declineStyleProposal?(p: StyleProposal): Promise<void>
  updateStyleRule?(id: string, patch: { text?: string; paused?: boolean }): Promise<StyleRule>
  /** Optional extras from @reelstudio/ai. */
  cancelSignInChatGPT?(): void | Promise<void>
  /** Stops setActive('claude-cli')'s check call, which then throws code 'cancelled'. Optional: older packages lack it. */
  cancelCheck?(): void
  /** A fresh look at the person's own Claude Code app (`bin` stays in main). Optional: older packages lack it. */
  claudeCodeStatus?(): Promise<ClaudeCodeStatus>
  /** The person's own servers (provider 'custom'). Optional: older packages and the mock lack them. */
  connections?(): Promise<ConnectionInfo[]>
  saveConnection?(input: ConnectionInput): Promise<SaveConnectionResult>
  removeConnection?(id: string): Promise<void>
  setConnectionImages?(id: string, supportsImages: boolean): Promise<void>
  connectionModels?(q: { kind: ConnectionInfo['kind']; baseURL: string; key?: string; id?: string }): Promise<{ models: string[]; suggested: string | null; needsKey: boolean }>
  /** Mock only: the sign-in window "opened" (tests flip the mock's state instead of opening a terminal). */
  mockClaudeSignInOpened?(): void
}

export interface ClaudeCodeStatus {
  state: 'missing' | 'broken' | 'signed_out' | 'ready'
  bin?: string
  version?: string
  plan?: string
  reason?: string
}

export interface CreateAIOptions {
  host: EngineHost
  settingsDir: string
  dev?: boolean
  secretStore?: SecretStore
  /** Settings › Editor › Models: a model per role, 'auto' for the editor's own (ai index.ts modelForRole). */
  roleModels?: () => Promise<Partial<Record<'editor' | 'checker' | 'writer', string>>>
}

export type CreateAI = (opts: CreateAIOptions) => AI
