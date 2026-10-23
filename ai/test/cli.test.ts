import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClaudeCliProvider, toolSchemas } from '../src';
import { waitWords } from '../src/agent';
import type { WaitSignal } from '../src/types';
import { extractJson, limitResetsAt, parseProtocolReply, renderConversation } from '../src/providers/cli';
import { tmpDir } from './helpers';

describe('CLI JSON protocol', () => {
  it('extracts JSON from fenced / chatty replies', () => {
    expect(extractJson('Sure!\n```json\n{"a":{"b":"}"}}\n```')).toEqual({ a: { b: '}' } });
    expect(extractJson('no json')).toBeNull();
  });
  it('parses tool calls', () => {
    const r = parseProtocolReply('{"thought":"cut","tool_calls":[{"name":"set_cut","arguments":{"keep":[]}},{"name":"finish","arguments":{"summary_for_user":"x"}}]}');
    expect(r.toolCalls.map((c) => c.name)).toEqual(['set_cut', 'finish']);
    expect(r.text).toBe('cut');
    expect(parseProtocolReply('hello').toolCalls).toEqual([]);
  });
  it('renders the conversation with the tool catalog; only latest images attached', () => {
    const img = { type: 'image' as const, mime: 'image/png', base64: 'AA' };
    const { text, images } = renderConversation({
      system: 'SYS', tools: toolSchemas(['set_cut', 'finish']),
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'TASK' }] },
        { role: 'assistant', text: '', toolCalls: [{ id: '1', name: 'look_at_frames', args: {} }] },
        { role: 'tool', results: [{ callId: '1', name: 'look_at_frames', content: 'old', images: [img] }] },
        { role: 'assistant', text: '', toolCalls: [{ id: '2', name: 'look_at_frames', args: {} }] },
        { role: 'tool', results: [{ callId: '2', name: 'look_at_frames', content: 'new', images: [img, img] }] },
      ],
    });
    expect(text).toMatch(/SYS/); expect(text).toMatch(/- set_cut:/); expect(text).toMatch(/TASK/);
    expect(text).toMatch(/no longer attached/);
    expect(images).toHaveLength(2);
  });
  it('ClaudeCliProvider drives a (fake) claude binary via stream-json', async () => {
    const dir = tmpDir();
    const script = path.join(dir, 'fake-claude.js');
    fs.writeFileSync(script, `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s.trim());const ok=m.message.content[0].text.includes('TOOLS:')&&process.argv.includes('--tools');process.stdout.write(JSON.stringify({type:'system'})+'\\n'+JSON.stringify({type:'result',is_error:false,result: ok?'{"tool_calls":[{"name":"finish","arguments":{"summary_for_user":"hi"}}]}':'bad'})+'\\n')})`);
    const p = new ClaudeCliProvider({ bin: process.execPath, binArgs: [script] });
    const r = await p.complete({ system: 'SYS', tools: toolSchemas(['finish']), messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }] });
    expect(r.toolCalls).toEqual([expect.objectContaining({ name: 'finish', args: { summary_for_user: 'hi' } })]);
  });
});

describe('waiting for Claude, said as it is', () => {
  // fails if the CLI's own retries and the start of its answer stay invisible (a note once waited 543 s on one call)
  it('passes on each retry the CLI reports, and the first piece of the answer once', async () => {
    const dir = tmpDir();
    const script = path.join(dir, 'fake-claude.js');
    const lines = [
      { type: 'system', subtype: 'init' },
      { type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: 'overloaded' },
      { type: 'stream_event', event: { type: 'message_start' } },
      { type: 'stream_event', event: { type: 'content_block_delta' } },
      { type: 'result', is_error: false, result: '{"tool_calls":[{"name":"finish","arguments":{"summary_for_user":"hi"}}]}' },
    ];
    fs.writeFileSync(script, `process.stdin.resume();process.stdin.on('end',()=>{process.stdout.write(${JSON.stringify(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')})})`);
    const seen: WaitSignal[] = [];
    const p = new ClaudeCliProvider({ bin: process.execPath, binArgs: [script] });
    await p.complete({ system: 'SYS', tools: toolSchemas(['finish']), messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }], onWait: (w) => seen.push(w) });
    expect(seen).toEqual([{ kind: 'retrying', attempt: 1, max: 10, delayMs: 500, status: 529 }, { kind: 'answering' }]);
  });

  it('says it is waiting after a quiet spell, names a retry, and goes back to the step once the answer starts', async () => {
    const said: [string, boolean][] = [];
    const w = waitWords({ id: 'claude-cli', reportsWaits: true }, (m, waiting) => said.push([m, waiting]), 'Picking your pictures', 30);
    await new Promise((r) => setTimeout(r, 60));
    w.onWait!({ kind: 'retrying', attempt: 2, max: 10, delayMs: 1000, status: 529 });
    w.onWait!({ kind: 'answering' });
    await new Promise((r) => setTimeout(r, 60));
    w.end();
    expect(said).toEqual([
      ['Waiting for Claude to answer', true],
      ['Claude is busy. Trying again (2 of 10)', true],
      ['Picking your pictures', false],
    ]);
    const quiet: string[] = [];
    const other = waitWords({ id: 'chatgpt' }, (m) => quiet.push(m), 'x', 10);
    await new Promise((r) => setTimeout(r, 40));
    other.end();
    expect([other.onWait, quiet]).toEqual([undefined, []]);
  });
});

describe('a plan at its limit: when it resets', () => {
  // fails if a reel paused at its plan limit cannot say when it continues, though the CLI said
  it('reads the reset time from both forms the Claude Code CLI uses, or says it does not know', () => {
    const now = new Date(2026, 9, 23, 14, 5);
    expect(limitResetsAt('Claude AI usage limit reached|1761170400', now)).toBe(new Date(1761170400 * 1000).toISOString());
    expect(limitResetsAt("5-hour limit reached ∙ resets 3pm", now)).toBe(new Date(2026, 9, 23, 15, 0).toISOString());
    expect(limitResetsAt("You've hit your limit · resets 3:40pm (America/Chicago)", now)).toBe(new Date(2026, 9, 23, 15, 40).toISOString());
    // a time already gone today is tomorrow's
    expect(limitResetsAt('limit reached, resets 9am', now)).toBe(new Date(2026, 9, 24, 9, 0).toISOString());
    expect(limitResetsAt('Claude usage limit reached', now)).toBeNull();
  });
});

