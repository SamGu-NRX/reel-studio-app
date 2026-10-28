// `claude -p` as the harness: Claude Code runs the agent loop and calls Reel Studio's tools natively
// over MCP, through the relay (relay/mcp-relay.js) and this process's run socket (run.ts), instead
// of the text protocol in providers/cli.ts that Claude answers in its own XML about 1 turn in 5.
// Claude Code's built-in tools, user settings, skills and every other MCP server are off, and it
// works in an empty folder. What agent.ts enforces per run is enforced here and in run.ts: steps,
// the token budget, KEEP_GOING after a turn that ends without finish, one mutating call at a time.
import { spawn } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { AIError, ChatMessage, ImagePart, ToolCall } from '../types';
import { DEFAULT_TOKEN_BUDGET, KEEP_GOING, MAX_CONSECUTIVE_MISSES, RunAgentResult, effectiveTokens, preloadText, thinkingMessage } from '../agent';
import { Harness, HarnessRun } from '../harness';
import { cliEnv } from '../safety';
import { endTree } from '../engineHost';
import { userLine } from '../providers/cli';
import { McpRun } from './run';

/** The relay ships beside src/ and dist/ (package.json `files`), two folders up from this file in both. */
export const RELAY_SCRIPT = path.join(__dirname, '..', '..', 'relay', 'mcp-relay.js');

/** Claude Code's limit on one MCP tool call (MCP_TOOL_TIMEOUT, ms); a draft render with pictures
 * takes minutes. Checked with Claude Code 2.1.309: 5000 failed a 12 s call ("timed out after 5s"),
 * and a 150 s call passed both with this value and with none set. Its default is not known beyond
 * 150 s, so it is set rather than trusted. */
export const TOOL_TIMEOUT_MS = 20 * 60_000;

/** After finish, how long claude gets to end its turn and exit once its input is closed. */
const EXIT_GRACE_MS = 10_000;

export interface ClaudeCodeOptions {
  /** the person's `claude` (localClaude.ts finds it); default `claude` on PATH */
  bin?: string;
  /** args placed before claude's own (a script path for a test double) */
  binArgs?: string[];
  model?: string;
  effort?: string;
  extraArgs?: string[];
  /** how claude starts the relay; default this process's binary as Node running RELAY_SCRIPT */
  relay?: { command: string; args: string[] };
  /** whole-run limit (default 30 minutes) */
  timeoutMs?: number;
  /** base environment for the CLI (cliEnv removes ANTHROPIC_* and OPENAI_*); default process.env */
  env?: NodeJS.ProcessEnv;
}

const PREFIX = 'mcp__reelstudio__';
const mcpName = (tool: string) => PREFIX + tool;

type Outcome = { stoppedBy: RunAgentResult['stoppedBy'] } | { error: unknown };

export class ClaudeCodeHarness implements Harness {
  readonly id = 'claude-code' as const;
  /** Claude Code 2.1.309 passes MCP image results to the model: a solid green swatch from a tool
   * was named "Green" with no hint in the text. */
  readonly supportsImages = true;
  readonly model: string;
  constructor(private readonly o: ClaudeCodeOptions = {}) { this.model = o.model ?? 'sonnet'; }

  private args(tools: string[], mcpFile: string, systemFile: string): string[] {
    return [
      ...(this.o.binArgs ?? []),
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--mcp-config', mcpFile, '--strict-mcp-config', '--tools', '',
      // the exact list, no wildcard: a tool the run does not allow is not even offered
      '--allowedTools', tools.map(mcpName).join(','),
      '--permission-prompts', 'none', '--setting-sources', '', '--disable-slash-commands', '--no-session-persistence',
      '--model', this.model,
      ...(this.o.effort ? ['--effort', this.o.effort] : []),
      '--system-prompt-file', systemFile,
      ...(this.o.extraArgs ?? []),
    ];
  }

  async run(o: HarnessRun): Promise<RunAgentResult> {
    const pre = o.preload?.length ? await preloadText(o.ctx, o.preload) : '';
    if (o.signal?.aborted) throw new AIError('cancelled', 'Stopped.');
    let decide: (x: Outcome) => void = () => undefined;
    const outcome = new Promise<Outcome>((resolve) => {
      let done = false;
      decide = (x) => { if (!done) { done = true; resolve(x); } };
    });
    const run = await McpRun.open({
      ctx: o.ctx, tools: o.tools, customTools: o.customTools, maxSteps: o.maxSteps, onEvent: o.onEvent,
      onStop: (why) => decide(why === 'steps' ? { stoppedBy: 'steps' } : { error: run.failure }),
    });
    try {
      const mcpFile = path.join(run.dir, 'mcp.json');
      const systemFile = path.join(run.dir, 'system.txt');
      // One fixed empty folder, not one per run: Claude Code makes a record in its own settings
      // folder for every working folder it is started in (seen with 2.1.309).
      const cwd = path.join(os.tmpdir(), 'reelstudio-claude-code');
      await fsp.mkdir(cwd, { recursive: true });
      const relay = this.o.relay ?? { command: process.execPath, args: [RELAY_SCRIPT] };
      await fsp.writeFile(mcpFile, JSON.stringify({ mcpServers: { reelstudio: {
        type: 'stdio', command: relay.command, args: relay.args,
        env: { ELECTRON_RUN_AS_NODE: '1', REELSTUDIO_SOCKET: run.socket, REELSTUDIO_RUN: run.id, REELSTUDIO_RUN_TOKEN: run.token },
      } } }), { mode: 0o600 });
      await fsp.writeFile(systemFile, o.system, { mode: 0o600 });
      return await this.drive(o, run, pre, this.args(o.tools, mcpFile, systemFile), cwd, outcome, decide);
    } finally {
      await run.close();
    }
  }

  private async drive(o: HarnessRun, run: McpRun, pre: string, args: string[], cwd: string, outcome: Promise<Outcome>, decide: (x: Outcome) => void): Promise<RunAgentResult> {
    const child = spawn(this.o.bin ?? 'claude', args, {
      cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      // its own process group, so Stop ends claude and whatever it started (killTree)
      detached: process.platform !== 'win32',
      env: cliEnv(this.o.env, { MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS) }),
    });
    const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
    let tokens = 0;
    const budget = o.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const overBudget = () => new AIError('token_budget', 'This edit was taking far more AI work than it should, so I stopped to protect your AI usage. Try a shorter, more specific note.', { detail: `${tokens} effective tokens > budget ${budget}` });
    let errTail = '';
    child.stderr.setEncoding('utf8').on('data', (d: string) => { errTail = (errTail + d).slice(-800); });
    child.stdin.on('error', () => undefined);
    child.on('error', (e) => decide({ error: new AIError('cli_missing', 'The claude command line tool is not installed or not on PATH.', { detail: e.message }) }));
    child.on('close', (code) => {
      if (tokens > budget) decide({ error: overBudget() });
      else if (o.ctx.state.finished !== null) decide({ stoppedBy: 'finish' });
      else decide({ error: new AIError('cli_error', 'The AI did not answer.', { retryable: true, detail: `exit ${code}: ${errTail}` }) });
    });
    const send = (line: string) => { try { child.stdin.write(line); } catch { /* gone: close decides */ } };

    const images = this.supportsImages ? (o.taskImages ?? []) : [];
    const first: ChatMessage = { role: 'user', content: [{ type: 'text', text: o.task + pre }, ...images] };
    const messages: ChatMessage[] = [first];
    const seen = new Set<string>();
    const allowed = new Set(o.tools.map(mcpName));
    let misses = 0; let usedTools = false;
    const maxMisses = o.maxMisses ?? MAX_CONSECUTIVE_MISSES;

    const onEvent = (j: any) => {
      if (j?.type === 'system' && j.subtype === 'init') {
        const server = (j.mcp_servers ?? []).find((s: any) => s?.name === 'reelstudio');
        // claude reports the tools the model can call; anything but ours (a built-in tool, an account
        // connector) means the flags no longer switch the rest off, and the run must not go on
        const foreign = (Array.isArray(j.tools) ? j.tools : []).filter((t: unknown) => !allowed.has(String(t)));
        if (server?.status !== 'connected') {
          decide({ error: new AIError('harness_mcp', 'The AI could not reach the editing tools.', { retryable: true, detail: `reelstudio MCP server: ${server?.status ?? 'missing'}` }) });
        } else if (foreign.length) {
          decide({ error: new AIError('harness_tools', 'The AI was offered tools Reel Studio does not control, so I stopped.', { detail: `claude offered: ${foreign.join(', ')}` }) });
        }
      } else if (j?.type === 'assistant') {
        const id = String(j.message?.id ?? seen.size);
        const blocks: any[] = Array.isArray(j.message?.content) ? j.message.content : [];
        const calls: ToolCall[] = blocks.filter((b) => b?.type === 'tool_use')
          .map((b) => ({ id: String(b.id), name: String(b.name).replace(PREFIX, ''), args: b.input ?? {} }));
        if (calls.length) usedTools = true;
        const text = blocks.filter((b) => b?.type === 'text').map((b) => String(b.text)).join('');
        if (!seen.has(id)) { seen.add(id); messages.push({ role: 'assistant', text, toolCalls: calls }); }
        else {
          const last = messages.at(-1);
          if (last?.role === 'assistant') { last.text += text; last.toolCalls.push(...calls); }
        }
      } else if (j?.type === 'result') {
        const u = j.usage ?? {};
        tokens += effectiveTokens({ input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens }, 0);
        if (j.is_error) {
          const limited = /limit|quota|rate/i.test(String(j.result ?? '')) || j.api_error_status === 429;
          return decide({ error: new AIError(limited ? 'cli_limited' : 'cli_error', limited ? 'The AI hit its usage limit. Try again later.' : 'The AI had a problem answering.', { retryable: !limited, detail: String(j.result ?? '').slice(0, 500) }) });
        }
        // before finish is accepted: a run over budget is not saved, even one that has finished
        if (tokens > budget) return decide({ error: overBudget() });
        if (o.ctx.state.finished !== null) return decide({ stoppedBy: 'finish' });
        // a turn that ended without finish: as agent.ts, only turns in a row with no tool call end the run
        misses = usedTools ? 0 : misses + 1;
        usedTools = false;
        if (misses >= maxMisses) return decide({ stoppedBy: 'no_tools' });
        o.onEvent({ type: 'status', message: thinkingMessage(messages), phase: 'edit', thinking: true });
        send(userLine(KEEP_GOING, []));
      }
    };
    let buf = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i); buf = buf.slice(i + 1);
        let j: any; try { j = JSON.parse(l); } catch { continue; }
        onEvent(j);
      }
    });

    const abort = () => decide({ error: new AIError('cancelled', 'Stopped.') });
    o.signal?.addEventListener('abort', abort, { once: true });
    if (o.signal?.aborted) abort();      // Stop while the run was being set up: the listener never fires
    const timer = setTimeout(() => decide({ error: new AIError('cli_timeout', 'The AI took too long to answer.', { retryable: true }) }), this.o.timeoutMs ?? 30 * 60_000);
    try {
      o.onEvent({ type: 'status', message: thinkingMessage([]), phase: 'edit', thinking: true });
      send(userLine(o.task + pre, images.map((img: ImagePart, k) => ({ label: `user image ${k + 1}`, img }))));
      const end = await outcome;
      const finished = 'stoppedBy' in end && end.stoppedBy === 'finish';
      if (finished) {
        // its input ends, so claude ends its turn and exits by itself
        try { child.stdin.end(); } catch { /* gone */ }
        await Promise.race([exited, new Promise((r) => setTimeout(r, EXIT_GRACE_MS).unref())]);
      }
      // calls that are running settle first (Stop reaches them through ctx.signal), then the tree ends.
      // A process that outlives this cannot change the project: the run's socket closes next.
      await run.idle();
      const alive = child.exitCode === null && child.signalCode === null;
      // on macOS/Linux also once claude has exited: its group may still hold the relay
      if (alive || process.platform !== 'win32') await endTree(child.pid, () => { if (alive) child.kill('SIGKILL'); });
      await exited;
      if ('error' in end) throw end.error;
      if (o.signal?.aborted) throw new AIError('cancelled', 'Stopped.');
      return { finished: o.ctx.state.finished, steps: seen.size, messages, tokens, stoppedBy: o.ctx.state.finished !== null ? 'finish' : end.stoppedBy };
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', abort);
    }
  }
}
