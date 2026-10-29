import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AIError, createAI, type SecretStore } from '../src';
import { ClaudeCliProvider } from '../src/providers/cli';
import { FakeHub } from './fakeHub';
import { fakeCli } from './fake-cli';
import { FakeHost, tmpDir } from './helpers';

const fakeSafeStorage: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b.map((x) => x ^ 0x5a)).toString('utf8'),
};
const caught = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a failure'); }, (e) => e as AIError);

let hub: FakeHub;
let dir: string;
let roles: Record<string, string>;
const make = () => createAI({ host: new FakeHost(tmpDir()), settingsDir: dir, secretStore: fakeSafeStorage, roleModels: () => roles });
beforeEach(async () => {
  hub = new FakeHub();
  await hub.start();
  dir = tmpDir();
  roles = {};
});
afterEach(async () => { await hub.stop(); });

describe('CLIProxyAPI as the editor', () => {
  it('keeps the key in the encrypted store, says where it came from, and saves nothing for a refused key', async () => {
    const ai = make();
    const bad = await ai.saveHub({ origin: hub.origin, key: 'stale-key', keySource: '/opt/homebrew/etc/cliproxyapi.conf' });
    expect(bad.error?.code).toBe('hub_key');
    expect(await ai.connections()).toEqual([]);

    const r = await ai.saveHub({ origin: `${hub.origin}/`, key: hub.key, keySource: '/opt/homebrew/etc/cliproxyapi.conf' });
    expect(r.status.connected).toBe(true);
    expect(r.status.label).toBe('CLIProxyAPI');
    const [c] = await ai.connections();
    expect(c).toMatchObject({ kind: 'cliproxy', baseURL: hub.origin, keySource: '/opt/homebrew/etc/cliproxyapi.conf', hasKey: true, active: true, hasManagementKey: false });
    // the suggested model, not the hub's first one
    expect(c.model).toBe('claude-sonnet-5-5');
    for (const f of fs.readdirSync(dir)) expect(fs.readFileSync(path.join(dir, f)).includes(hub.key)).toBe(false);
    expect(fakeSafeStorage.decryptString(fs.readFileSync(path.join(dir, `connection-${c.id}.bin`)))).toBe(hub.key);

    // connecting again updates the one hub instead of adding a second
    await ai.saveHub({ origin: hub.origin, key: hub.key, keySource: 'typed' });
    expect((await ai.connections()).map((x) => x.keySource)).toEqual(['typed']);
  });

  it('sends a Claude model to Messages and a GPT model to Chat Completions, each with its reasoning level', async () => {
    const ai = make();
    await ai.saveHub({ origin: hub.origin, key: hub.key, keySource: 'typed' });
    roles = { editor: 'claude-opus-5-5(high)', checker: 'gpt-6.1-sol(medium)' };

    const claude = await ai.testConnection(undefined, 'editor');
    expect(claude).toMatchObject({ reply: 'OK', model: 'claude-opus-5-5(high)' });
    expect(claude.ms).toBeGreaterThanOrEqual(0);
    expect(hub.requests.at(-1)).toMatchObject({ path: '/v1/messages', header: 'x-api-key', key: 'client', model: 'claude-opus-5-5(high)' });

    await ai.testConnection(undefined, 'checker');
    expect(hub.requests.at(-1)).toMatchObject({ path: '/v1/chat/completions', header: 'bearer', key: 'client', model: 'gpt-6.1-sol(medium)' });

    // a stage left on Auto uses the hub connection's own model
    await ai.testConnection(undefined, 'planner');
    expect(hub.requests.at(-1)).toMatchObject({ path: '/v1/messages', model: 'claude-sonnet-5-5' });
  });

  it('lists models with the hub’s names, levels and order, without hidden ones; ids when it has no catalog', async () => {
    const ai = make();
    await ai.saveHub({ origin: hub.origin, key: hub.key, keySource: 'typed' });
    const models = await ai.editorModels();
    expect(models.map((m) => m.id)).toEqual(['gpt-6.1-sol', 'gpt-6-luna', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']);
    expect(models[2]).toMatchObject({ name: 'Claude Sonnet 5.5', family: 'claude', efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' });
    expect(models[0]).toMatchObject({ name: 'GPT 6.1 Sol', family: 'gpt', defaultEffort: 'low' });

    hub.noCatalog = true;
    const plain = await make().editorModels(); // a fresh app: nothing cached
    expect(plain.find((m) => m.id === 'claude-opus-5-5')).toMatchObject({ name: 'Claude Opus 5.5', family: 'claude', efforts: [] });
    expect(plain.some((m) => m.id === 'gpt-image-2')).toBe(true); // no catalog says it is hidden
  });

  it('says which accounts hit a limit, when they reset, and which model runs on other accounts', async () => {
    const ai = make();
    await ai.saveHub({ origin: hub.origin, key: hub.key, keySource: 'typed' });
    hub.limited = { family: 'claude', resetSeconds: 3720 };
    const before = Date.now();
    const e = await caught(ai.testConnection(undefined, 'editor'));
    expect(e.code).toBe('connection_limited');
    expect(e.userMessage).toMatch(/^Your server’s Claude accounts are all at their limit for claude-sonnet-5-5\. The first is free again at .+ \(in 1 h 2 min\)\. GPT 6\.1 Sol runs on your ChatGPT accounts: choose it in Settings, under Editor\.$/);
    expect(Date.parse(e.resetsAt!) - before).toBeGreaterThanOrEqual(3720_000 - 1000);
  });

  it('reads accounts, plans and limits with the management key, and refuses a wrong one without saving it', async () => {
    const ai = make();
    await ai.saveHub({ origin: hub.origin, key: hub.key, keySource: 'typed' });
    expect(await ai.editorAccounts()).toEqual({ accounts: [], needsManagementKey: true });

    const wrong = await caught(ai.setHubManagementKey('nope'));
    expect(wrong.code).toBe('hub_management_key');
    expect((await ai.connections())[0].hasManagementKey).toBe(false);

    hub.accounts = [...hub.accounts, { provider: 'claude', email: 'old@example.com', used: [0, 0], resetsInMin: [1, 1], broken: true }];
    await ai.setHubManagementKey(hub.managementKey);
    const { accounts } = await ai.editorAccounts();
    expect(accounts.map((a) => [a.provider, a.name, a.plan])).toEqual([
      ['claude', 'maya@example.com', undefined], ['claude', 'studio@example.com', undefined], ['codex', 'maya@example.com', 'Pro'], ['claude', 'old@example.com', undefined],
    ]);
    expect(accounts[0].windows.map((w) => [w.label, w.left])).toEqual([['5-hour', 62], ['Weekly', 39]]);
    expect(accounts[1].windows[0]).toMatchObject({ label: '5-hour', left: 0 });
    expect(Date.parse(accounts[1].windows[0].resetsAt!)).toBeGreaterThan(Date.now() + 40 * 60_000);
    expect(accounts[2].windows.map((w) => [w.label, w.left])).toEqual([['5-hour', 88], ['Weekly', 96]]);
    expect(accounts[3]).toMatchObject({ windows: [], problem: 'Couldn’t read this account’s limits.' });
    // the management key only ever went to the management API, and the client key never did
    expect(hub.requests.filter((r) => r.key === 'management').every((r) => r.path.startsWith('/v0/management/'))).toBe(true);
    expect(hub.requests.filter((r) => r.path.startsWith('/v0/')).every((r) => r.key !== 'client')).toBe(true);

    hub.managementOff = true;
    expect((await ai.editorAccounts()).problem).toMatch(/management API is off/);
  });
});

describe('Claude Code at its limit', () => {
  it('names the window and its reset time, and keeps the windows it reported', async () => {
    const resetsAt = Math.round(Date.now() / 1000) + 14 * 3600;
    const event = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'seven_day', unifiedWindows: {
      five_hour: { utilization: 0, resetsAt: resetsAt - 3600, status: 'allowed' },
      seven_day: { utilization: 1, resetsAt, status: 'rejected' },
    } } };
    const result = { type: 'result', is_error: true, result: 'You have hit your weekly limit · resets soon', api_error_status: 429 };
    const bin = fakeCli('claude', { stdout: `${JSON.stringify(event)}\n${JSON.stringify(result)}` });
    const e = await caught(new ClaudeCliProvider({ bin }).complete({ system: '', messages: [{ role: 'user', content: [{ type: 'text', text: 'OK?' }] }], tools: [], jsonOnly: true }));
    expect(e.code).toBe('cli_limited');
    expect(e.userMessage).toMatch(/^Your Claude Code account has hit its weekly limit\. It resets (tomorrow )?at .+ \(in 14 h\)\.$/);
    expect(e.resetsAt).toBe(new Date(resetsAt * 1000).toISOString());
    expect(e.limits).toEqual([
      { label: '5-hour', left: 100, resetsAt: new Date((resetsAt - 3600) * 1000).toISOString() },
      { label: 'Weekly', left: 0, resetsAt: new Date(resetsAt * 1000).toISOString() },
    ]);
  });
});
