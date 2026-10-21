// A note is all-or-nothing (audit rows "failed final render reports success" and "crash breaks note transaction").
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createAI, loadProject, ModelProvider, newToolState, runAgent, StyleStore } from '../src';
import { NoteTransaction, recoverNote } from '../src/noteTxn';
import { FakeHost, ScriptedModel, makeProject, call, tmpDir, tinyPng } from './helpers';

describe('note transaction', () => {
  it('a final render that fails after a preview of an earlier edit is not success, and the earlier preview stays', async () => {
    const { root, dir } = await makeProject();
    const host = new FakeHost(root);
    const engine = host.runEngine.bind(host);
    host.runEngine = async (command, args, ...rest) => {
      if (command === 'render' && !args.includes('--draft')) throw { code: 'RENDER_FAILED', userMessage: 'The video could not be made.' };
      return engine(command, args, ...rest);
    };
    const before = await fsp.readFile(path.join(dir, 'project.json'), 'utf8');
    const draft = path.join(dir, 'versions', 'preview', 'draft.mp4');
    await fsp.mkdir(path.dirname(draft), { recursive: true });
    await fsp.writeFile(draft, 'the preview from before the note');
    const m = new ScriptedModel([
      { toolCalls: [call('set_gap_cap', { seconds: 0.4 }), call('render_draft')] },
      { toolCalls: [call('set_gap_cap', { seconds: 0.8 }), call('finish', { summary_for_user: 'I slowed down the pauses.' })] },
    ]);
    await expect(createAI({ host, settingsDir: tmpDir(), providerOverride: m }).applyNote(dir, 'slower', () => undefined))
      .rejects.toMatchObject({ code: 'note_not_saved', userMessage: expect.stringMatching(/back the way it was/) });
    expect(await fsp.readFile(path.join(dir, 'project.json'), 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(dir, 'versions', 'v1'))).toBe(false);
    expect(await fsp.readFile(draft, 'utf8')).toBe('the preview from before the note');
  });

  it('a failed note removes the files it made and keeps a file the user added meanwhile', async () => {
    const { root, dir } = await makeProject();
    const host = new FakeHost(root);
    host.failRender = true;
    const userFile = path.join(dir, 'work', 'assets', 'user-reference.png');
    const m = new ScriptedModel([
      { toolCalls: [call('fetch_image', { url: 'https://example.com/loaf.png', name: 'loaf' }), call('set_gap_cap', { seconds: 0.4 })] },
      () => { fs.writeFileSync(userFile, tinyPng()); return { toolCalls: [call('finish', { summary_for_user: 'done' })] }; },
    ]);
    const fetchImpl = (async () => new Response(tinyPng(), { headers: { 'content-type': 'image/png' } })) as typeof fetch;
    await expect(createAI({ host, settingsDir: tmpDir(), providerOverride: m, fetch: fetchImpl, lookup: async () => ['93.184.215.14'] })
      .applyNote(dir, 'slower', () => undefined)).rejects.toBeTruthy();
    expect(await fsp.readdir(path.join(dir, 'work', 'assets'))).toEqual(['user-reference.png']);
  });

  it('a marker copied from another project is refused and restores nothing', async () => {
    const a = await makeProject();
    const b = await makeProject();
    await NoteTransaction.begin(a.dir, new StyleStore(() => a.root), 'n1');
    const marker = path.join('work', '.note-in-progress');
    await fsp.cp(path.join(a.dir, marker), path.join(b.dir, marker), { recursive: true });
    const before = await fsp.readFile(path.join(b.dir, 'project.json'));
    expect(await recoverNote(b.dir, new StyleStore(() => b.root))).toBe('refused');
    expect(await fsp.readFile(path.join(b.dir, 'project.json'))).toEqual(before);
    expect(fs.existsSync(path.join(b.dir, marker))).toBe(false);
  });

  it('the app dying after a change: the next start puts back the exact project bytes', async () => {
    const { root, dir } = await makeProject();
    const before = await fsp.readFile(path.join(dir, 'project.json'));
    let mutated!: () => void;
    const changed = new Promise<void>((r) => { mutated = r; });
    let n = 0;
    // one change, then the process "dies": the run never settles, so no catch or finally runs
    const dying: ModelProvider = { id: 'fake', supportsImages: false, complete: async () => {
      if (n++ === 0) return { text: '', toolCalls: [{ id: 'k1', name: 'set_gap_cap', args: { seconds: 0.9 } }] };
      mutated();
      return new Promise<never>(() => undefined);
    } };
    void createAI({ host: new FakeHost(root), settingsDir: tmpDir(), providerOverride: dying }).applyNote(dir, 'slower', () => undefined);
    await changed;
    expect((await loadProject(dir)).cut.gapCap).toBe(0.9);

    const restarted = createAI({ host: new FakeHost(root), settingsDir: tmpDir(), providerOverride: new ScriptedModel([]) });
    expect(await restarted.recoverNote(dir)).toBe('undone');
    expect(await fsp.readFile(path.join(dir, 'project.json'))).toEqual(before);
  });

  it('a repeated tool call id runs once', async () => {
    const { root, dir } = await makeProject();
    const ctx = { projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root), state: newToolState(), emit: () => undefined, supportsImages: false };
    const add = { id: 'same-id', name: 'add_broll', args: { anchor: { from: 'w16', to: 'w26' }, treatment: 'text-pop', params: { text: 'Bread' } } };
    await runAgent({ provider: new ScriptedModel([{ toolCalls: [add, add] }]), system: 's', task: 't', ctx, onEvent: () => undefined, maxSteps: 1 });
    expect((await loadProject(dir)).broll).toHaveLength(1);
  });
});
