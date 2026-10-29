// The person's Codex app's plan and limits, asked of the Codex app itself: `codex app-server` speaks JSON lines on
// stdio, and its `account/read` and `account/rateLimits/read` answer without spending any of the plan. Reel Studio
// still never opens ~/.codex: the e-mail in the answer is dropped here.
import { spawn } from 'node:child_process';
import type { LimitWindow } from '../types';
import { cliEnv } from '../safety';
import { EFFORTS, chatgptPlanLabel, windowLabel, type Effort, type HubModel } from './hub';

export interface CodexAccount {
  /** "Plus", "Pro"…; absent for an API-key sign-in or a plan this does not know */
  plan?: string;
  windows: LimitWindow[];
  /** the models this sign-in offers (`model/list`), the Codex app's default first */
  models: HubModel[];
}

/** `model/list` entries: id, displayName, hidden, supportedReasoningEfforts [{reasoningEffort}], defaultReasoningEffort. */
export function codexModels(data: any[]): HubModel[] {
  return data
    .filter((m) => typeof m?.id === 'string' && !m.hidden)
    .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault))
    .map((m) => {
      const efforts = EFFORTS.filter((e) => (m.supportedReasoningEfforts ?? []).some((x: any) => (x?.reasoningEffort ?? x) === e));
      const def = EFFORTS.find((e) => e === m.defaultReasoningEffort);
      return {
        id: m.id,
        name: typeof m.displayName === 'string' && m.displayName ? m.displayName.replace(/^GPT-(\d[\d.]*)-/, 'GPT-$1 ') : m.id,
        family: 'gpt' as const,
        efforts,
        ...(def && efforts.includes(def) ? { defaultEffort: def as Effort } : {}),
        images: Array.isArray(m.inputModalities) ? m.inputModalities.includes('image') : true,
      };
    });
}

const TIMEOUT_MS = 10_000;

/** One window of `account/rateLimits/read`: usedPercent, windowDurationMins and resetsAt (epoch seconds). */
export function codexRateWindows(snapshot: any): LimitWindow[] {
  const out: LimitWindow[] = [];
  const plan = String(snapshot?.planType ?? '').toLowerCase();
  const add = (w: any, fallback: string) => {
    if (!w || typeof w.usedPercent !== 'number') return;
    out.push({
      label: windowLabel(typeof w.windowDurationMins === 'number' ? w.windowDurationMins : null, fallback),
      left: Math.max(0, Math.min(100, Math.round(100 - w.usedPercent))),
      ...(typeof w.resetsAt === 'number' && w.resetsAt > 0 ? { resetsAt: new Date(w.resetsAt * 1000).toISOString() } : {}),
    });
  };
  add(snapshot?.primary, plan === 'free' || plan === 'go' ? 'Monthly' : '5-hour');
  add(snapshot?.secondary, 'Weekly');
  return out;
}

/** null when the Codex app could not be asked (an older version without app-server, or no answer in time). */
export async function readCodexAccount(bin: string, env: NodeJS.ProcessEnv): Promise<CodexAccount | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, ['app-server'], { env: cliEnv(env), windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const pending = new Map<number, (r: any) => void>();
    let buf = '';
    let id = 0;
    let done = false;
    const finish = (v: CodexAccount | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill(); } catch { /* gone */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    child.on('error', () => finish(null));
    child.on('close', () => finish(null));
    child.stdin?.on('error', () => undefined);
    child.stdout?.setEncoding('utf8').on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let j: any;
        try { j = JSON.parse(line); } catch { continue; }
        if (typeof j?.id === 'number' && pending.has(j.id)) { pending.get(j.id)!(j); pending.delete(j.id); }
      }
    });
    const ask = (method: string, params: unknown) => new Promise<any>((res) => {
      const n = ++id;
      pending.set(n, res);
      child.stdin?.write(`${JSON.stringify({ id: n, method, params })}\n`);
    });
    void (async () => {
      const init = await ask('initialize', { clientInfo: { name: 'reel-studio', title: 'Reel Studio', version: '1' }, capabilities: { experimentalApi: true } });
      if (!init?.result) return finish(null);
      child.stdin?.write(`${JSON.stringify({ method: 'initialized' })}\n`);
      const acc = await ask('account/read', {});
      const a = acc?.result?.account;
      const limits = await ask('account/rateLimits/read', null);
      const snap = limits?.result?.rateLimits;
      const plan = chatgptPlanLabel(a?.type === 'chatgpt' ? a.planType : undefined) ?? chatgptPlanLabel(snap?.planType);
      const listed = await ask('model/list', {});
      const models = Array.isArray(listed?.result?.data) ? codexModels(listed.result.data) : [];
      finish({ ...(plan ? { plan } : {}), windows: snap ? codexRateWindows(snap) : [], models });
    })().catch(() => finish(null));
  });
}
