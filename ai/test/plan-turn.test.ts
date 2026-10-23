import { describe, it, expect } from 'vitest';
import { createAI, AgentEvent, CompletionRequest, CompletionResponse, ModelProvider, PlanTurnInput } from '../src';
import { plannedScript, readPlanTurn } from '../src/editor';
import { FakeHost, ScriptedModel, tmpDir } from './helpers';

const PLAN = { say: 'I went with a confession.', title: 'Bread, no mixer', hooks: ['A', 'B'], beats: ['one', 'two', 'three'], shots: ['me at the counter'] };
const ai = (model: ModelProvider) => createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir(), providerOverride: model });
const idea: PlanTurnInput = { turns: [{ from: 'you', text: 'sourdough without a mixer' }], asked: 0, plan: null };

describe('readPlanTurn', () => {
  it('takes a question only while questions are left', () => {
    expect(readPlanTurn({ question: 'Who is it for?' }, 0)).toEqual({ kind: 'question', text: 'Who is it for?' });
    expect(readPlanTurn({ question: 'Who is it for?' }, 2)).toBeNull();
  });

  it('takes a plan with 2-3 hooks, 3-6 beats and 1-6 shots, one line each', () => {
    expect(readPlanTurn(PLAN, 2)).toEqual({ kind: 'plan', ...PLAN });
    expect(readPlanTurn({ ...PLAN, hooks: ['A'] }, 0)).toBeNull();
    expect(readPlanTurn({ ...PLAN, beats: ['one', 'two'] }, 0)).toBeNull();
    expect(readPlanTurn({ ...PLAN, shots: [] }, 0)).toBeNull();
    const long = readPlanTurn({ ...PLAN, hooks: ['A', 'B', 'C', 'D'], beats: ['1', '2', '3', '4', '5', '6', '7'], shots: ['a\nb — c', ' '] }, 0);
    expect(long).toMatchObject({ hooks: ['A', 'B', 'C'], beats: ['1', '2', '3', '4', '5', '6'], shots: ['a b, c'] });
    expect(readPlanTurn('{}', 0)).toBeNull();
  });
});

describe('planTurn', () => {
  // fails if the editor can keep asking, or a reply that is not a plan is taken as one
  it('asks again for the plan once the questions are spent', async () => {
    const model = new ScriptedModel([{ text: '{"question":"And what should they remember?"}' }, { text: JSON.stringify(PLAN) }]);
    const turns: PlanTurnInput['turns'] = [
      { from: 'you', text: 'sourdough without a mixer' },
      { from: 'editor', text: 'Who is it for?', kind: 'question' },
      { from: 'you', text: 'people who never baked' },
      { from: 'editor', text: 'What should they take away?', kind: 'question' },
      { from: 'you', text: 'you need no gear' },
      { from: 'you', text: 'really, none' },
    ];
    const r = await ai(model).planTurn({ turns, asked: 2, plan: null }, () => undefined);
    expect(r).toEqual({ kind: 'plan', ...PLAN });
    const first = model.requests[0];
    expect(first.jsonOnly).toBe(true);
    expect(first.system).toMatch(/propose the plan now/);
    // the creator's two messages in a row go as one, so the sides alternate
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect((first.messages[4] as any).content[0].text).toBe('you need no gear\n\nreally, none');
    expect((first.messages[1] as any).text).toBe('{"question":"Who is it for?"}');
    expect((model.requests[1].messages.at(-1) as any).content[0].text).toMatch(/No questions are left/);
  });

  it('gives the plan as it stands, with the picked hook, when asked for a change', async () => {
    const model = new ScriptedModel([{ text: JSON.stringify(PLAN) }]);
    await ai(model).planTurn({ turns: [{ from: 'you', text: 'shorter hook' }], asked: 1, plan: { hooks: ['X', 'Y'], hook: 1, beats: ['b1', 'b2', 'b3'], shots: ['s1'] } }, () => undefined);
    expect(model.requests[0].system).toMatch(/- X\n- \(picked\) Y/);
    expect(model.requests[0].system).toMatch(/1\. b1\n2\. b2\n3\. b3/);
  });

  it('fails loudly after two replies it cannot use', async () => {
    const model = new ScriptedModel([{ text: 'sure!' }, { text: '{"hooks":["A"]}' }]);
    await expect(ai(model).planTurn(idea, () => undefined)).rejects.toMatchObject({ code: 'plan_failed' });
  });

  // fails if a planning call shows only its step while Claude is busy (round 9.1's honest waits)
  it('says the wait in place of the step, and Stop ends the call', async () => {
    const events: AgentEvent[] = [];
    let release: (() => void) | null = null;
    const claude: ModelProvider = {
      id: 'claude-cli', supportsImages: false, reportsWaits: true,
      complete: (req: CompletionRequest) => new Promise<CompletionResponse>((resolve, reject) => {
        req.onWait?.({ kind: 'retrying', attempt: 1, max: 3, delayMs: 1000, status: 529 });
        req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Stopped.'), { code: 'cancelled' })));
        release = () => resolve({ text: '{"question":"Who is it for?"}', toolCalls: [] });
      }),
    };
    const stop = new AbortController();
    const turn = ai(claude).planTurn(idea, (e) => events.push(e), stop.signal);
    await new Promise((r) => setTimeout(r, 10));
    expect(events.filter((e) => e.type === 'status').map((e) => [(e as any).message, !!(e as any).waiting])).toEqual([
      ['Planning your reel', false],
      ['Claude is busy. Trying again (1 of 3)', true],
    ]);
    stop.abort();
    await expect(turn).rejects.toMatchObject({ code: 'cancelled' });
    expect(release).not.toBeNull();
  });

  it('needs an editor and the creator to have said something', async () => {
    await expect(createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir() }).planTurn(idea, () => undefined)).rejects.toMatchObject({ code: 'no_ai' });
    await expect(ai(new ScriptedModel([])).planTurn({ turns: [], asked: 0, plan: null }, () => undefined)).rejects.toMatchObject({ code: 'plan_input' });
  });
});

// fails if the shots planned before filming never reach the first edit
it('the first edit reads the planned shots with the script', () => {
  const text = plannedScript({ script: { hook: 'H.', script: 'one\ntwo', shots: ['me at the counter', ' ', 3] } });
  expect(text).toMatch(/H\.\none\ntwo\n\nWhat they planned to film:\n- me at the counter$/);
});
