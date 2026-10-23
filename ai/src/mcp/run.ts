// The main-process side of one MCP harness run. The relay (relay/mcp-relay.js) that `claude -p`
// starts connects to this run's socket and forwards every tools/list and tools/call; the calls run
// here, through executeTool on the note's ToolContext, so they edit the note's private copy of the
// project and never project.json (editor.ts applyNote saves that once, after the run).
//
// Socket messages are newline-delimited JSON:
//   relay -> main  {"hello":{"run":"<id>","token":"<token>"}}      then {"id":7,"call":{"name":"set_cut","args":{...}}}
//   main -> relay  {"tools":[ToolSchema,...]} or {"error":"..."}   then {"id":7,"result":{"content":"...","images":[...],"isError":false}}
import * as fsp from 'node:fs/promises';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { HarnessTool } from '../harness';
import { AgentEvent, ToolSchema } from '../types';
import { executeTool, toolSchemas, ToolContext } from '../tools';
import { PARALLEL_SAFE, STAGE, thinkingMessage } from '../agent';

export interface McpRunOptions {
  ctx: ToolContext;
  customTools?: HarnessTool[];
  /** the only tools this run may call; a call to any other is refused here, whatever the client was told */
  tools: string[];
  /** tool calls before every call but finish is refused */
  maxSteps: number;
  onEvent: (e: AgentEvent) => void;
  /** the run must end now: `steps` after STEP_GRACE refused calls past maxSteps, `fatal` when a tool
   * threw an error that ends the edit (Stop, an AI error, a stuck engine; see `failure`) */
  onStop: (why: 'steps' | 'fatal') => void;
}

interface CallResult { content: string; images?: { mime: string; base64: string }[]; isError: boolean }

/** refused calls past maxSteps before the run is stopped (the model was told twice to call finish) */
export const STEP_GRACE = 2;
const HELLO_TIMEOUT_MS = 5000;
/** a relay line longer than this is not a tool call */
const MAX_LINE = 4 * 1024 * 1024;

const errorResult = (error: string): CallResult => ({ content: JSON.stringify({ error }), isError: true });
/** A call the run will not answer because it is ending (Stop, a fatal tool error). */
const ENDED: CallResult = errorResult('run ended');

/** Parallel-safe tools share the project; every other call has it alone, in arrival order (as
 * agent.ts runCalls does inside one reply). */
class CallLock {
  private gate: Promise<unknown> = Promise.resolve();
  private readers: Promise<unknown>[] = [];
  run<T>(shared: boolean, fn: () => Promise<T>): Promise<T> {
    if (shared) {
      const p = this.gate.then(fn);
      this.readers.push(p.catch(() => undefined));
      return p;
    }
    const p = Promise.all([this.gate, ...this.readers]).then(fn);
    this.gate = p.catch(() => undefined);
    this.readers = [];
    return p;
  }
}

export class McpRun {
  readonly id = randomUUID();
  readonly token = randomBytes(32).toString('base64url');
  readonly schemas: ToolSchema[];
  /** tool calls counted against maxSteps */
  calls = 0;
  /** what a tool threw that ends the run; the harness rethrows it */
  failure: unknown = null;
  private ended = false;
  private claimed: net.Socket | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly running = new Set<Promise<unknown>>();
  private readonly lock = new CallLock();
  private readonly server: net.Server;

  private constructor(readonly dir: string, readonly socket: string, private readonly o: McpRunOptions) {
    this.schemas = [...toolSchemas(o.tools), ...(o.customTools ?? []).filter((t) => o.tools.includes(t.schema.name)).map((t) => t.schema)];
    this.server = net.createServer((s) => this.onConnection(s));
  }

  /** A 0700 folder (mkdtemp) holds the socket; on Windows a named pipe with a random name. */
  static async open(o: McpRunOptions): Promise<McpRun> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rs-mcp-'));
    const name = randomBytes(12).toString('hex');
    const socket = process.platform === 'win32' ? `\\\\.\\pipe\\reelstudio-${name}` : path.join(dir, `${name}.sock`);
    const run = new McpRun(dir, socket, o);
    try {
      await new Promise<void>((resolve, reject) => {
        run.server.once('error', reject);
        run.server.listen(socket, () => { run.server.off('error', reject); resolve(); });
      });
      if (process.platform !== 'win32') await fsp.chmod(socket, 0o600);
    } catch (e) {
      await fsp.rm(dir, { recursive: true, force: true });
      throw e;
    }
    return run;
  }

  /** Settles once no call is running. */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  /** Ends the run: later connections and calls are refused, running calls settle first, then the
   * socket and its folder go. */
  async close(): Promise<void> {
    this.ended = true;
    await this.idle();
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    await fsp.rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
  }

  private helloOk(h: any): boolean {
    if (!h || h.run !== this.id || typeof h.token !== 'string') return false;
    const a = Buffer.from(h.token); const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private onConnection(sock: net.Socket): void {
    this.sockets.add(sock);
    const send = (m: unknown) => { if (!sock.destroyed) sock.write(JSON.stringify(m) + '\n'); };
    const refuse = (error: string) => { send({ error }); sock.end(); };
    // declared before the handlers: a connection refused at once closes before any timer is set
    let timer: NodeJS.Timeout | undefined;
    sock.on('close', () => { this.sockets.delete(sock); if (timer) clearTimeout(timer); });
    sock.on('error', () => undefined);
    if (this.ended) return refuse('run ended');
    let authed = false;
    let buf = '';
    timer = setTimeout(() => refuse('no hello'), HELLO_TIMEOUT_MS);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => {
      buf += d;
      if (buf.length > MAX_LINE) { sock.destroy(); return; }
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m: any;
        try { m = JSON.parse(line); } catch { sock.destroy(); return; }
        if (!authed) {
          if (timer) clearTimeout(timer);
          if (!this.helloOk(m?.hello)) return refuse('refused');
          if (this.ended) return refuse('run ended');
          if (this.claimed) return refuse('run already has a connection');
          this.claimed = sock; authed = true;
          send({ tools: this.schemas });
          continue;
        }
        if (typeof m?.id !== 'number' || typeof m?.call?.name !== 'string') continue;
        if (this.ended) { send({ id: m.id, error: 'run ended' }); continue; }
        const p: Promise<void> = this.call(m.call.name, m.call.args ?? {})
          .then((result) => send(result === ENDED ? { id: m.id, error: 'run ended' } : { id: m.id, result }))
          .finally(() => this.running.delete(p));
        this.running.add(p);
      }
    });
  }

  private async call(name: string, args: unknown): Promise<CallResult> {
    const { ctx } = this.o;
    if (!this.o.tools.includes(name)) return errorResult(`the tool "${name}" is not available in this task`);
    if (ctx.state.finished !== null) return errorResult('finish was already called');
    if (this.ended || ctx.signal?.aborted || this.failure) return ENDED;
    if (name !== 'finish' && ++this.calls > this.o.maxSteps) {
      if (this.calls > this.o.maxSteps + STEP_GRACE) this.o.onStop('steps');
      return errorResult('You are out of steps. Call finish now with your summary for the user.');
    }
    return this.lock.run(PARALLEL_SAFE.has(name), async () => {
      // checked again once the call has the project: one queued behind a running call must not
      // start after close() began, or after Stop, a fatal error or finish
      if (this.ended || ctx.signal?.aborted || this.failure || ctx.state.finished !== null) return ENDED;
      const stage = STAGE[name];
      if (stage) this.o.onEvent({ type: 'status', message: stage.message, pct: stage.pct, phase: 'edit' });
      try {
        const custom = this.o.customTools?.find((t) => t.schema.name === name);
        const r: Awaited<ReturnType<typeof executeTool>> = custom ? await custom.execute(args) : await executeTool(ctx, name, args);
        return { content: r.content, isError: r.isError, ...(r.images?.length ? { images: r.images.map((img) => ({ mime: img.mime, base64: img.base64 })) } : {}) };
      } catch (e) {
        // what ends the edit in runAgent (Stop, an AIError, a stuck engine) ends this run the same way
        this.failure ??= e;
        this.o.onStop('fatal');
        return ENDED;
      } finally {
        // no other call is running, so the model is thinking again (agent.ts shows this between turns)
        if (this.running.size <= 1) this.o.onEvent({ type: 'status', message: thinkingMessage([{ role: 'tool', results: [{ callId: '', name, content: '' }] }]), phase: 'edit', thinking: true });
      }
    });
  }
}
