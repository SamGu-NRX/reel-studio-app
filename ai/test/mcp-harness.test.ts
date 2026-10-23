// The MCP harness (mcp/run.ts, relay/mcp-relay.js, mcp/claudeCode.ts): claude -p calls the editor's
// tools natively over MCP, and every call runs in main inside the note's transaction.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { createAI, ClaudeCodeHarness, StyleStore, TOOL_NAMES, toolSchemas, newToolState, listVersions } from '../src';
import type { ToolContext } from '../src';
import { McpRun, McpRunOptions } from '../src/mcp/run';
import { RELAY_SCRIPT } from '../src/mcp/claudeCode';
import { KEEP_GOING } from '../src/agent';
import { FakeHost, ScriptedModel, firstVersion, makeProject, tmpDir } from './helpers';

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude-mcp.js');

async function noteSetup() {
  const { root, dir } = await makeProject();
  const host = new FakeHost(root);
  await firstVersion(dir, host);
  const projectFile = path.join(dir, 'project.json');
  const before = await fsp.readFile(projectFile);
  // what applyNote's begin() does: the note edits a private copy
  const noteDir = path.join(dir, 'work', 'notes', 'n1');
  await fsp.mkdir(noteDir, { recursive: true });
  const file = path.join(noteDir, 'edit.json');
  await fsp.writeFile(file, before);
  const ctx: ToolContext = {
    projectDir: dir, host, style: new StyleStore(() => root), emit: () => undefined, state: newToolState(),
    supportsImages: true, note: { id: 'n1', file, dir: noteDir },
  };
  return { root, dir, host, ctx, projectFile, editFile: file, before };
}

const runs: McpRun[] = [];
const clients: Relay[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const r of runs.splice(0)) await r.close();
});

async function openRun(ctx: ToolContext, o: Partial<McpRunOptions> = {}): Promise<McpRun> {
  const run = await McpRun.open({ ctx, tools: TOOL_NAMES, maxSteps: 25, onEvent: () => undefined, onStop: () => undefined, ...o });
  runs.push(run);
  return run;
}

/** A scripted MCP client: the relay as claude starts it, spoken to over its stdio. */
class Relay {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (m: any) => void>();
  private id = 0;
  constructor(run: McpRun, token = run.token) {
    this.child = spawn(process.execPath, [RELAY_SCRIPT], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', REELSTUDIO_SOCKET: run.socket, REELSTUDIO_RUN: run.id, REELSTUDIO_RUN_TOKEN: token },
    });
    let buf = '';
    this.child.stdout.setEncoding('utf8').on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        this.waiting.get(m.id)?.(m); this.waiting.delete(m.id);
      }
    });
    clients.push(this);
  }
  request(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async ready(): Promise<any> {
    await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    return this.request('tools/list');
  }
  call(name: string, args: Record<string, unknown>): Promise<any> {
    return this.request('tools/call', { name, arguments: args }).then((m) => m.result);
  }
  close(): void { this.child.stdin.end(); }
}

const text = (r: any) => r.content.map((c: any) => c.text ?? '').join('');

describe('the relay', () => {
  it('lists exactly toolSchemas() over MCP', async () => {
    const { ctx } = await noteSetup();
    const list = await new Relay(await openRun(ctx)).ready();
    expect(list.result.tools.map((t: any) => ({ name: t.name, description: t.description, parameters: t.inputSchema }))).toEqual(toolSchemas());
  });

  it('runs a call on the note copy: edit.json changes, project.json keeps its bytes', async () => {
    const { ctx, projectFile, editFile, before } = await noteSetup();
    const relay = new Relay(await openRun(ctx));
    await relay.ready();
    const r = await relay.call('set_caption_style', { case: 'lower' });
    expect(r.isError).toBe(false);
    expect(JSON.parse(await fsp.readFile(editFile, 'utf8')).captions.style.case).toBe('lower');
    expect((await fsp.readFile(projectFile)).equals(before)).toBe(true);
  });

  it('refuses a wrong token', async () => {
    const { ctx, editFile, before } = await noteSetup();
    const run = await openRun(ctx);
    const relay = new Relay(run, 'x'.repeat(run.token.length));
    const list = await relay.ready();
    expect(list.error?.message).toMatch(/refused/);
    const r = await relay.call('set_caption_style', { case: 'lower' });
    expect(r.isError).toBe(true);
    expect((await fsp.readFile(editFile)).equals(before)).toBe(true);
  });

  it('refuses a second connection to a run', async () => {
    const { ctx } = await noteSetup();
    const run = await openRun(ctx);
    expect((await new Relay(run).ready()).result.tools.length).toBe(TOOL_NAMES.length);
    expect((await new Relay(run).ready()).error?.message).toMatch(/already has a connection/);
  });

  it('refuses a call after the run ended', async () => {
    const { ctx, editFile, before } = await noteSetup();
    const run = await openRun(ctx);
    const relay = new Relay(run);
    await relay.ready();
    await run.close();
    const r = await relay.call('set_caption_style', { case: 'lower' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/run ended/);
    expect((await fsp.readFile(editFile)).equals(before)).toBe(true);
    expect(ctx.state.toolCalls).toBe(0);
  });

  it('refuses in main a tool outside the run allowlist, whatever the client asks', async () => {
    const { ctx, editFile, before } = await noteSetup();
    const relay = new Relay(await openRun(ctx, { tools: ['get_project', 'finish'] }));
    expect((await relay.ready()).result.tools.map((t: any) => t.name)).toEqual(['get_project', 'finish']);
    const r = await relay.call('set_caption_style', { case: 'lower' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not available/);
    expect(ctx.state.toolCalls).toBe(0);
    expect((await fsp.readFile(editFile)).equals(before)).toBe(true);
  });

  it('past maxSteps refuses every call but finish, and stops the run two calls later', async () => {
    const { ctx } = await noteSetup();
    const stops: string[] = [];
    const relay = new Relay(await openRun(ctx, { maxSteps: 1, onStop: (why) => stops.push(why) }));
    await relay.ready();
    expect((await relay.call('get_project', {})).isError).toBe(false);
    for (let k = 0; k < 2; k++) expect(text(await relay.call('get_project', {}))).toMatch(/out of steps/);
    expect(stops).toEqual([]);
    expect(text(await relay.call('get_project', {}))).toMatch(/out of steps/);
    expect(stops).toEqual(['steps']);
    expect((await relay.call('finish', { summary_for_user: 'Nothing to change here.' })).isError).toBe(false);
    expect(ctx.state.finished).toBe('Nothing to change here.');
  });
});

describe('a note through Claude Code (a stand-in claude)', () => {
  async function setup(turns: unknown[], extra: Record<string, unknown> = {}) {
    const { root, dir } = await makeProject();
    const host = new FakeHost(root);
    await firstVersion(dir, host);
    const work = tmpDir('fake claude ');
    const scenario = { turns, pidFile: path.join(work, 'pids.json'), inbox: path.join(work, 'inbox.txt'), ...extra };
    const file = path.join(work, 'scenario.json');
    await fsp.writeFile(file, JSON.stringify(scenario));
    const model = new ScriptedModel([]);
    const harness = new ClaudeCodeHarness({ bin: process.execPath, binArgs: [FAKE_CLAUDE], extraArgs: ['--scenario', file] });
    const ai = createAI({ host, settingsDir: tmpDir('settings '), providerOverride: model, harnessOverride: harness });
    const read = () => fsp.readFile(path.join(dir, 'project.json'), 'utf8');
    return { dir, ai, model, scenario, read, before: await read() };
  }
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; } };

  it('runs the tools natively, asks again after a turn without finish, and saves one version', async () => {
    const { dir, ai, model, scenario, read } = await setup([
      [{ name: 'set_caption_style', args: { case: 'lower' } }],
      [{ name: 'finish', args: { summary_for_user: 'Your subtitles are lowercase now.' } }],
    ]);
    const r = await ai.applyNote(dir, 'lowercase subtitles', () => undefined);
    expect(r.summary).toBe('Your subtitles are lowercase now.');
    expect(r.version).toBe(2);
    expect(await listVersions(dir)).toEqual([1, 2]);
    expect(JSON.parse(await read()).captions.style.case).toBe('lower');
    expect(model.requests).toEqual([]);                     // no text protocol: the provider was never asked
    expect(fs.readFileSync(scenario.inbox, 'utf8').split('\n---\n')[1]).toBe(KEEP_GOING);
    const pids = JSON.parse(fs.readFileSync(scenario.pidFile, 'utf8'));
    expect([alive(pids.claude), alive(pids.relay)]).toEqual([false, false]);
  });

  it('Stop mid-run leaves no claude or relay process, and the project as it was', async () => {
    const { dir, ai, scenario, read, before } = await setup([[{ name: 'set_gap_cap', args: { seconds: 0.4 } }, 'hang']]);
    const ac = new AbortController();
    await expect(ai.applyNote(dir, 'slower please', (e) => { if (e.type === 'tool') ac.abort(); }, ac.signal)).rejects.toMatchObject({ code: 'cancelled' });
    const pids = JSON.parse(fs.readFileSync(scenario.pidFile, 'utf8'));
    expect([alive(pids.claude), alive(pids.relay)]).toEqual([false, false]);
    expect(await read()).toBe(before);
    expect(fs.readdirSync(path.join(dir, 'work', 'notes'))).toEqual([]);
  });

  it('Stop pressed while the run starts ends it, with no claude or relay left', async () => {
    const { ctx } = await noteSetup();
    const work = tmpDir('fake claude ');
    const scenario = { turns: [['hang']], pidFile: path.join(work, 'pids.json'), inbox: path.join(work, 'inbox.txt') };
    await fsp.writeFile(path.join(work, 'scenario.json'), JSON.stringify(scenario));
    const harness = new ClaudeCodeHarness({ bin: process.execPath, binArgs: [FAKE_CLAUDE], extraArgs: ['--scenario', path.join(work, 'scenario.json')] });
    const ac = new AbortController();
    const running = harness.run({ system: 'SYS', task: 'go', ctx: { ...ctx, signal: ac.signal }, tools: TOOL_NAMES, maxSteps: 5, onEvent: () => undefined, signal: ac.signal });
    ac.abort();                // the run is still opening its socket
    await expect(running).rejects.toMatchObject({ code: 'cancelled' });
    if (fs.existsSync(scenario.pidFile)) {
      const pids = JSON.parse(fs.readFileSync(scenario.pidFile, 'utf8'));
      expect([alive(pids.claude), alive(pids.relay)]).toEqual([false, false]);
    }
  });

  it('will not run when claude offers the model any tool but ours', async () => {
    const { dir, ai, read, before } = await setup([[{ name: 'set_caption_style', args: { case: 'lower' } }]], { initTools: ['Bash', 'mcp__reelstudio__finish'] });
    await expect(ai.applyNote(dir, 'lowercase subtitles', () => undefined)).rejects.toMatchObject({ code: 'harness_tools' });
    expect(await read()).toBe(before);
  });
});
