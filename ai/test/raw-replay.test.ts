// #92: a reply sent back for a JSON correction keeps its `raw` (Claude's thinking blocks), so the retry replays the
// reasoning instead of dropping it. These are beta's own correction loops, which #92 could not see.
import { describe, expect, it } from 'vitest';
import { createAI, CompletionRequest, CompletionResponse, ModelProvider } from '../src';
import { askChecker } from '../src/checker';
import { FakeHost, tmpDir } from './helpers';

const THOUGHT = [{ type: 'thinking', thinking: 'They asked for one change.', signature: 'sig' }, { type: 'text', text: 'not json' }];

/** Answers `first` with THOUGHT as its raw, then `then`; keeps every request. */
function model(then: string): ModelProvider & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    id: 'claude', supportsImages: false, requests,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      requests.push(structuredClone({ ...req, signal: undefined }));
      return requests.length === 1 ? { text: 'not json', toolCalls: [], raw: THOUGHT } : { text: then, toolCalls: [] };
    },
  } as ModelProvider & { requests: CompletionRequest[] };
}
const replayed = (m: { requests: CompletionRequest[] }) => (m.requests[1].messages[1] as { raw?: unknown }).raw;
const ai = (m: ModelProvider) => createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir(), providerOverride: m });

describe('a JSON correction replays the reply it corrects', () => {
  it('fails if the planning chat drops the thinking of the reply it asks to fix', async () => {
    const m = model('{"question":"Who is it for?"}');
    await ai(m).planTurn({ turns: [{ from: 'you', text: 'sourdough without a mixer' }], asked: 0, plan: null }, () => undefined);
    expect(replayed(m)).toEqual(THOUGHT);
  });

  it('fails if Try 2\'s proposal drops the thinking of the reply it asks to fix', async () => {
    const m = model('{"variable":"cover","value":3.1,"reason":"I picked your smile."}');
    await ai(m).proposeTry({ caption: 'Hi\nOne bowl.', duration: 20, words: [], coverSeconds: null });
    expect(replayed(m)).toEqual(THOUGHT);
  });

  it('fails if the edit checker drops the thinking of the reply it asks to fix', async () => {
    const m = model('{}');
    await askChecker(m, 'Check the edit.', { text: 'the edit', images: [], frames: { shown: 0, total: 0 } as never }, null);
    expect(replayed(m)).toEqual(THOUGHT);
  });
});
