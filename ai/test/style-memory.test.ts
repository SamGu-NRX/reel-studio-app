import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { StyleStore, captionCaseProposal } from '../src/style';

const store = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rs-style-'));
  return new StyleStore(() => root);
};

describe("What I've learned", () => {
  it('fails if new words on a rule are not dated, or a pause dates it', async () => {
    const s = store();
    const { rule } = await s.add('Keep music quiet');
    expect(rule.updatedAt).toBeUndefined();
    const edited = await s.update(rule.id, { text: 'Keep music quieter' });
    expect(Date.parse(edited.updatedAt!)).toBeGreaterThanOrEqual(Date.parse(rule.createdAt));
    const paused = await s.update(rule.id, { paused: true });
    expect(paused.updatedAt).toBe(edited.updatedAt);
    expect((await s.list())[0].updatedAt).toBe(edited.updatedAt);
  });

  it('fails if a rule typed in by the person is not marked as theirs', async () => {
    const s = store();
    expect((await s.add('Big subtitles', { byYou: true })).rule.byYou).toBe(true);
    expect((await s.add('No emojis')).rule.byYou).toBeUndefined();
  });

  it('fails if a paused rule still reaches the editor or new reels', async () => {
    const s = store();
    const typed = await s.approve(captionCaseProposal({ project: 'bread', title: 'Bread', version: 1 }));
    if (typed.status !== 'saved') throw new Error('not saved');
    const { rule } = await s.add('Keep music quiet');
    await s.update(typed.rule.id, { paused: true });
    await s.update(rule.id, { paused: true });
    expect(await s.asPromptText()).toBe('(none yet)');
    expect(await s.captionCase()).toBeNull();
  });
});
