// A fake CLIProxyAPI for tests: /v1/models (and its catalog for any client_version), Chat Completions, Messages
// (streamed), the management API's auth-files and api-call, and a limit on demand. The ai tests and the app's e2e
// both run it, on a random port. Records each request with which key it carried, never the key itself.
import * as http from 'node:http';

export interface FakeHubModel { id: string; ownedBy: string; name?: string; efforts?: string[]; defaultEffort?: string; hidden?: boolean; textOnly?: boolean }
export interface FakeHubAccount {
  provider: 'claude' | 'codex';
  email: string;
  plan?: string;
  /** percent used: [5-hour or primary, weekly or secondary] */
  used: [number, number];
  resetsInMin: [number, number];
  /** the usage page refuses this account */
  broken?: boolean;
}

export const FAKE_MODELS: FakeHubModel[] = [
  { id: 'gpt-6.1-sol', ownedBy: 'openai', name: 'GPT 6.1 Sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'low' },
  { id: 'gpt-6-luna', ownedBy: 'openai', name: 'GPT 6.0 Luna', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'claude-sonnet-5-5', ownedBy: 'anthropic', name: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' },
  { id: 'claude-opus-5-5', ownedBy: 'anthropic', name: 'Claude Opus 5.5', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' },
  { id: 'claude-haiku-5-5', ownedBy: 'anthropic', name: 'Claude Haiku 5.5', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
  { id: 'gpt-image-2', ownedBy: 'openai', name: 'GPT Image 2', hidden: true },
];

export const FAKE_ACCOUNTS: FakeHubAccount[] = [
  { provider: 'claude', email: 'maya@example.com', used: [38, 61], resetsInMin: [134, 3 * 1440] },
  { provider: 'claude', email: 'studio@example.com', used: [100, 72], resetsInMin: [42, 5 * 1440] },
  { provider: 'codex', email: 'maya@example.com', plan: 'pro', used: [12, 4], resetsInMin: [250, 6 * 1440] },
];

export interface FakeHubRequest { method: string; path: string; query: string; key: 'client' | 'management' | 'wrong' | 'none'; header: 'bearer' | 'x-api-key' | 'none'; model?: string; images?: number }

export class FakeHub {
  server!: http.Server;
  origin = '';
  port = 0;
  requests: FakeHubRequest[] = [];
  /** answer every /v1 call 401, as if the key in the config were stale */
  rejectKey = false;
  /** answer Claude (or ChatGPT) models 429 model_cooldown */
  limited: { family: 'claude' | 'gpt'; resetSeconds: number } | null = null;
  /** no catalog: an older hub that only lists ids */
  noCatalog = false;
  /** the management API is switched off (no secret-key in its config) */
  managementOff = false;
  /** a hostile or buggy hub: the chat answer repeats the key it was sent */
  echo = false;
  /** the management API's refusal repeats the key it was sent */
  managementEcho = false;
  /** the chat answer is the agent's finish tool call (a whole note in one turn), not "OK" */
  finish = false;
  constructor(public readonly key = 'hub-client-key', public readonly managementKey = 'hub-management-key', public models = FAKE_MODELS, public accounts = FAKE_ACCOUNTS) {}

  async start(port = 0): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res).catch((e) => res.writeHead(500).end(String(e))));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.port = (this.server.address() as any).port;
    this.origin = `http://127.0.0.1:${this.port}`;
  }
  async stop(): Promise<void> { this.server.closeAllConnections?.(); await new Promise((r) => this.server.close(r)); }

  private json(res: http.ServerResponse, status: number, obj: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(obj));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const url = new URL(req.url!, 'http://x');
    const bearer = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
    const xKey = String(req.headers['x-api-key'] ?? '');
    const given = bearer || xKey;
    const key: FakeHubRequest['key'] = !given ? 'none' : given === this.key ? 'client' : given === this.managementKey ? 'management' : 'wrong';
    const images = JSON.stringify(body ?? '').split('"image_url"').length - 1 + JSON.stringify(body ?? '').split('"type":"image"').length - 1;
    this.requests.push({ method: req.method!, path: url.pathname, query: url.search, key, header: bearer ? 'bearer' : xKey ? 'x-api-key' : 'none', ...(typeof body?.model === 'string' ? { model: body.model, images } : {}) });

    if (url.pathname === '/healthz') return this.json(res, 200, { status: 'ok' });

    if (url.pathname.startsWith('/v0/management/')) {
      if (this.managementOff) return this.json(res, 403, { error: 'remote management key not set' });
      if (!bearer) return this.json(res, 401, { error: 'missing management key' });
      if (this.managementEcho) return this.json(res, 500, { error: `could not use ${bearer}` });
      if (bearer !== this.managementKey) return this.json(res, 401, { error: 'invalid management key' });
      if (url.pathname === '/v0/management/auth-files') {
        return this.json(res, 200, {
          files: this.accounts.map((a, i) => ({
            id: `${a.provider}-${i}.json`, auth_index: String(i), name: `${a.provider}-${i}.json`, provider: a.provider, email: a.email, status: 'active', disabled: false,
            ...(a.provider === 'codex' ? { id_token: { plan_type: a.plan, chatgpt_account_id: `acct-${i}` } } : {}),
          })).concat([{ id: 'gemini-9.json', auth_index: '9', name: 'gemini-9.json', provider: 'gemini', email: 'x@example.com', status: 'active', disabled: false } as any]),
        });
      }
      if (url.pathname === '/v0/management/api-call' && req.method === 'POST') {
        const a = this.accounts[Number(body?.auth_index)];
        if (!a || a.broken) return this.json(res, 200, { status_code: 401, body: '{"error":"expired"}' });
        if (body?.header?.Authorization !== 'Bearer $TOKEN$') return this.json(res, 200, { status_code: 400, body: '{}' });
        const now = Date.now();
        const usage = a.provider === 'claude'
          ? { five_hour: { utilization: a.used[0], resets_at: new Date(now + a.resetsInMin[0] * 60_000).toISOString() }, seven_day: { utilization: a.used[1], resets_at: new Date(now + a.resetsInMin[1] * 60_000).toISOString() } }
          : { plan_type: a.plan, rate_limit: {
            primary_window: { used_percent: a.used[0], reset_at: Math.round(now / 1000 + a.resetsInMin[0] * 60), limit_window_seconds: 18_000 },
            secondary_window: { used_percent: a.used[1], reset_at: Math.round(now / 1000 + a.resetsInMin[1] * 60), limit_window_seconds: 604_800 },
          } };
        return this.json(res, 200, { status_code: 200, body: JSON.stringify(usage) });
      }
      return this.json(res, 404, { error: 'not found' });
    }

    if (url.pathname.startsWith('/v1/')) {
      if (!given) return this.json(res, 401, { error: 'Missing API key' });
      if (given !== this.key || this.rejectKey) return this.json(res, 401, { error: 'Invalid API key' });
    }
    if (url.pathname === '/v1/models' && req.method === 'GET') {
      if (url.searchParams.has('client_version')) {
        if (this.noCatalog) return this.json(res, 500, { error: 'no catalog' });
        return this.json(res, 200, { models: this.models.map((m, i) => ({
          slug: m.id, display_name: m.name ?? m.id, priority: i + 1, visibility: m.hidden ? 'hide' : 'list',
          supported_reasoning_levels: (m.efforts ?? []).map((effort) => ({ effort, description: effort })),
          ...(m.defaultEffort ? { default_reasoning_level: m.defaultEffort } : {}), input_modalities: m.textOnly ? ['text'] : ['text', 'image'],
        })) });
      }
      // the plain list is in no useful order, as CLIProxyAPI's is
      return this.json(res, 200, { object: 'list', data: [...this.models].reverse().map((m) => ({ id: m.id, object: 'model', created: 0, owned_by: m.ownedBy })) });
    }
    const model = String(body?.model ?? '');
    const bare = model.replace(/\((low|medium|high|xhigh|max)\)$/, '');
    const family = bare.startsWith('claude') ? 'claude' : 'gpt';
    if ((url.pathname === '/v1/chat/completions' || url.pathname === '/v1/messages') && req.method === 'POST') {
      if (!this.models.some((m) => m.id === bare)) return this.json(res, 404, { error: { message: `model ${bare} not found`, type: 'invalid_request_error' } });
      if (this.limited?.family === family) {
        return this.json(res, 429, { error: { code: 'model_cooldown', message: `All credentials for model ${bare} are cooling down`, model: bare, reset_time: `${this.limited.resetSeconds}s`, reset_seconds: this.limited.resetSeconds, provider: family === 'claude' ? 'claude' : 'codex' } }, { 'retry-after': String(this.limited.resetSeconds) });
      }
      if (url.pathname === '/v1/chat/completions') {
        if (this.finish) {
          return this.json(res, 200, { id: 'c1', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ summary_for_user: 'Which words?' }) } }] }, finish_reason: 'tool_calls' }] });
        }
        const said = this.echo ? `OK. You sent ${given}` : 'OK';
        return this.json(res, 200, { id: 'c1', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: said }, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 1 } });
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: this.echo ? `OK. You sent ${given}` : 'OK' } });
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
      ev('message_stop', {});
      return res.end();
    }
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found');
  }
}
