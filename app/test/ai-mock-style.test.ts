import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMockAI } from '../src/main/ai-mock'
import type { EngineHost } from '../src/main/ai-types'

// The stand-in AI is what the app runs when @reelstudio/ai fails to load, so it writes the real My style.json.
describe('My style in the stand-in AI', () => {
  it('a rule saved while a Yes is being saved keeps both', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rs-mock-style '))
    const unused = (): never => { throw new Error('not used by My style') }
    const host: EngineHost = { reelStudioRoot: () => root, runEngine: unused, renderAnimation: unused }
    const ai = createMockAI({ host, settingsDir: root })
    const proposal = { id: 'q1', text: 'Use lowercase captions.', payload: { kind: 'caption-case', case: 'lower' } as const, source: { project: 'p', title: 'Baking bread', version: 2 } }
    await Promise.all([ai.addStyleRule!('Keep music quieter under talking.'), ai.approveStyleProposal!(proposal)])
    expect((await ai.styleRules()).map((r) => r.text).sort()).toEqual(['Keep music quieter under talking.', 'Use lowercase captions.'])
  })
})
