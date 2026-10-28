// #92: Claude's thinking rides on a reply's `raw` and must go back unchanged on the next turn. The planning chat's
// turns live in app.json between turns, so the app has to keep each reply's raw and hand it back.
import { expect, it } from 'vitest'
import { createAI, type CompletionRequest, type CompletionResponse, type ModelProvider } from '../../ai/src'
import { FakeHost, tmpDir } from '../../ai/test/helpers'
import type { ChatMessage } from '../src/shared/api'
import { planReply, planTurns } from '../src/shared/plan'

const THOUGHT = [{ type: 'thinking', thinking: 'Ask who it is for first.', signature: 'sig-1' }, { type: 'text', text: '{"question":"Who is it for?"}' }]

it('fails if the second planning turn sends the first reply back without its thinking', async () => {
  const requests: CompletionRequest[] = []
  const claude = {
    id: 'claude', supportsImages: false,
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      requests.push(structuredClone({ ...req, signal: undefined }))
      return requests.length === 1
        ? { text: '{"question":"Who is it for?"}', toolCalls: [], raw: THOUGHT }
        : { text: '{"question":"What should they remember?"}', toolCalls: [] }
    }
  } as ModelProvider
  const ai = createAI({ host: new FakeHost(tmpDir()), settingsDir: tmpDir(), providerOverride: claude })
  const stamp = (m: Omit<ChatMessage, 'id' | 'at'>, i: number): ChatMessage => ({ ...m, id: `m${i}`, at: new Date().toISOString() })
  // as main/index.ts projects:planSay keeps the chat in app.json: the person's words, then the editor's reply line
  const chat: ChatMessage[] = [stamp({ from: 'you', text: 'sourdough without a mixer', plan: true }, 0)]
  const first = await ai.planTurn({ ...planTurns(chat), plan: null }, () => undefined)
  chat.push(stamp(planReply(first), 1), stamp({ from: 'you', text: 'people who bake on weekends', plan: true }, 2))
  // app.json is JSON: what is kept must survive a write and a read
  const kept: ChatMessage[] = JSON.parse(JSON.stringify(chat))
  await ai.planTurn({ ...planTurns(kept), plan: null }, () => undefined)
  const replayed = requests[1].messages.find((m) => m.role === 'assistant') as { raw?: unknown }
  expect(replayed.raw).toEqual(THOUGHT)
})
