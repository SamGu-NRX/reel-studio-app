// @ts-check
// The MCP server `claude -p` starts over stdio for one Reel Studio run. It holds no project logic:
// it connects to the run's socket in the app (ai/src/mcp/run.ts), proves it belongs to the run with
// the token, and forwards tools/list and tools/call there. Plain JavaScript with no dependencies, so
// the app's own binary runs it as Node (ELECTRON_RUN_AS_NODE=1) and no build step sits in between.
'use strict';
const net = require('node:net');

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const socketPath = process.env.REELSTUDIO_SOCKET;
const runId = process.env.REELSTUDIO_RUN;
const token = process.env.REELSTUDIO_RUN_TOKEN;

/** @param {unknown} m */
function reply(m) { process.stdout.write(JSON.stringify(m) + '\n'); }
/** @param {string} why */
function log(why) { process.stderr.write(`[reelstudio-relay] ${why}\n`); }

if (!socketPath || !runId || !token) {
  log('missing REELSTUDIO_SOCKET, REELSTUDIO_RUN or REELSTUDIO_RUN_TOKEN');
  process.exit(2);
}

/** @type {{ ok: true, tools: any[] } | { ok: false, error: string } | null} */
let hello = null;
/** @type {((v: NonNullable<typeof hello>) => void)[]} */
const helloWaiters = [];
/** @type {Map<number, (m: any) => void>} */
const pending = new Map();
let nextId = 1;
let ended = false;

function settleHello(/** @type {NonNullable<typeof hello>} */ h) {
  if (hello) return;
  hello = h;
  for (const w of helloWaiters.splice(0)) w(h);
}
/** @returns {Promise<NonNullable<typeof hello>>} */
function helloDone() { return hello ? Promise.resolve(hello) : new Promise((r) => helloWaiters.push(r)); }

const sock = net.connect(socketPath);
sock.setEncoding('utf8');
sock.on('connect', () => sock.write(JSON.stringify({ hello: { run: runId, token } }) + '\n'));
let sbuf = '';
sock.on('data', (/** @type {string} */ d) => {
  sbuf += d;
  let i;
  while ((i = sbuf.indexOf('\n')) >= 0) {
    const line = sbuf.slice(0, i); sbuf = sbuf.slice(i + 1);
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (!hello) {
      settleHello(Array.isArray(m?.tools) ? { ok: true, tools: m.tools } : { ok: false, error: String(m?.error ?? 'refused') });
      continue;
    }
    const w = typeof m?.id === 'number' ? pending.get(m.id) : undefined;
    if (w) { pending.delete(m.id); w(m); }
  }
});
const gone = () => {
  ended = true;
  settleHello({ ok: false, error: 'run ended' });
  for (const [id, w] of pending) { pending.delete(id); w({ id, error: 'run ended' }); }
};
sock.on('close', gone);
sock.on('error', (e) => { log(`socket: ${e.message}`); gone(); });

/** @param {string} name @param {unknown} args @returns {Promise<any>} */
function forward(name, args) {
  if (ended) return Promise.resolve({ error: 'run ended' });
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    sock.write(JSON.stringify({ id, call: { name, args } }) + '\n');
  });
}

/** @param {any} r */
function toMcpResult(r) {
  if (r.error) return { content: [{ type: 'text', text: JSON.stringify({ error: r.error }) }], isError: true };
  const res = r.result;
  const content = [{ type: 'text', text: String(res.content ?? '') }];
  for (const img of res.images ?? []) content.push(/** @type {any} */ ({ type: 'image', data: img.base64, mimeType: img.mime }));
  return { content, isError: !!res.isError };
}

/** @param {any} msg */
async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return reply({ jsonrpc: '2.0', id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'reelstudio', version: '1' } } });
    }
    if (method === 'ping') return reply({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') {
      const h = await helloDone();
      if (!h.ok) return reply({ jsonrpc: '2.0', id, error: { code: -32000, message: `Reel Studio refused this run: ${h.error}` } });
      return reply({ jsonrpc: '2.0', id, result: { tools: h.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) } });
    }
    if (method === 'tools/call') {
      const h = await helloDone();
      if (!h.ok) return reply({ jsonrpc: '2.0', id, result: toMcpResult({ error: h.error }) });
      return reply({ jsonrpc: '2.0', id, result: toMcpResult(await forward(String(params?.name ?? ''), params?.arguments ?? {})) });
    }
    if (isRequest) reply({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    if (isRequest) reply({ jsonrpc: '2.0', id, error: { code: -32603, message: String(/** @type {any} */ (e)?.message ?? e) } });
  }
}

let ibuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (/** @type {string} */ d) => {
  ibuf += d;
  let i;
  while ((i = ibuf.indexOf('\n')) >= 0) {
    const line = ibuf.slice(0, i).trim(); ibuf = ibuf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); continue; }
    void handle(msg);
  }
});
// the client is gone: so is this run's relay
process.stdin.on('end', () => { sock.destroy(); process.exit(0); });
