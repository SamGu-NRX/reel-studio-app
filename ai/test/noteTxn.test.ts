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

  it('a marker naming "work", "../x" or a backslash path is refused and deletes nothing', async () => {
    const { root, dir } = await makeProject();
    const outside = path.join(dir, '..', 'x');
    await fsp.writeFile(outside, 'not the note\'s');
    await NoteTransaction.begin(dir, new StyleStore(() => root), 'n1');
    const markerFile = path.join(dir, 'work', '.note-in-progress', 'note.json');
    const marker = JSON.parse(await fsp.readFile(markerFile, 'utf8'));
    await fsp.writeFile(markerFile, JSON.stringify({ ...marker, created: ['work', '../x', 'work/assets/..\\..\\..\\x'] }));
    expect(await recoverNote(dir, new StyleStore(() => root))).toBe('refused');
    expect(fs.existsSync(path.join(dir, 'work', 'transcript.json'))).toBe(true);
    expect(fs.existsSync(outside)).toBe(true);
  });

  it('a marker naming a file under a symlinked version folder deletes nothing outside the project', async () => {
    const { root, dir } = await makeProject();
    const outside = tmpDir('outside ');
    await fsp.writeFile(path.join(outside, 'keep.txt'), 'not the note\'s');
    await NoteTransaction.begin(dir, new StyleStore(() => root), 'n1');
    await fsp.mkdir(path.join(dir, 'versions'), { recursive: true });
    await fsp.symlink(outside, path.join(dir, 'versions', 'v1'));
    const markerFile = path.join(dir, 'work', '.note-in-progress', 'note.json');
    const marker = JSON.parse(await fsp.readFile(markerFile, 'utf8'));
    await fsp.writeFile(markerFile, JSON.stringify({ ...marker, created: ['versions/v1/keep.txt'] }));
    expect(await recoverNote(dir, new StyleStore(() => root))).toBe('blocked');
    expect(fs.existsSync(path.join(outside, 'keep.txt'))).toBe(true);
  });

  it('recovery through a symlinked work/assets deletes nothing outside and keeps its copies', async () => {
    const { root, dir } = await makeProject();
    await NoteTransaction.begin(dir, new StyleStore(() => root), 'n1');
    const outside = tmpDir('outside ');
    await fsp.writeFile(path.join(outside, 'credits.json'), '{}');
    await fsp.symlink(outside, path.join(dir, 'work', 'assets'));
    expect(await recoverNote(dir, new StyleStore(() => root))).toBe('blocked');
    expect(fs.existsSync(path.join(outside, 'credits.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'work', '.note-in-progress', 'project.json'))).toBe(true);
  });

  it('a note in a project with a symlinked version folder is refused before it changes anything', async () => {
    const { root, dir } = await makeProject();
    const p = await loadProject(dir);
    p.version = 1;
    await fsp.writeFile(path.join(dir, 'project.json'), JSON.stringify(p));
    const before = await fsp.readFile(path.join(dir, 'project.json'));
    await fsp.mkdir(path.join(dir, 'storage', 'v1'), { recursive: true });
    await fsp.mkdir(path.join(dir, 'versions'), { recursive: true });
    await fsp.symlink(path.join(dir, 'storage', 'v1'), path.join(dir, 'versions', 'v1'));
    const host = new FakeHost(root);
    host.failRender = true;
    const m = new ScriptedModel([{ toolCalls: [call('set_gap_cap', { seconds: 0.4 }), call('finish', { summary_for_user: 'done' })] }]);
    await expect(createAI({ host, settingsDir: tmpDir(), providerOverride: m }).applyNote(dir, 'slower', () => undefined))
      .rejects.toMatchObject({ code: 'note_unsafe_folder' });
    expect(await fsp.readFile(path.join(dir, 'project.json'))).toEqual(before);
  });

  it('a failed note puts back notes.md and project.json in the version folder it re-used', async () => {
    const { root, dir } = await makeProject();
    const p = await loadProject(dir);
    p.version = 1;
    await fsp.writeFile(path.join(dir, 'project.json'), JSON.stringify(p));
    const notes = path.join(dir, 'versions', 'v1', 'notes.md');
    await fsp.mkdir(path.dirname(notes), { recursive: true });
    await fsp.writeFile(notes, '# v1\n\nFirst edit.\n');
    const snapshot = path.join(dir, 'versions', 'v1', 'project.json');
    await fsp.writeFile(snapshot, JSON.stringify(p));
    const host = new FakeHost(root);
    const engine = host.runEngine.bind(host);
    // the engine re-uses v1 for an edit that renders the same video (a post-only note) and rewrites its project.json
    host.runEngine = async (command, args, ...rest) => {
      if (command !== 'render' || args.includes('--draft')) return engine(command, args, ...rest);
      await fsp.copyFile(path.join(dir, 'project.json'), snapshot);
      return { version: 1 };
    };
    const m = new ScriptedModel([
      { toolCalls: [call('write_post', { caption: 'Bread', hashtags: ['a', 'b', 'c', 'd', 'e'], keywords: [] }), call('finish', { summary_for_user: 'New caption.' })] },
    ]);
    // anything after the snapshot fails: here the last progress event
    const onEvent = (e: { type: string; message?: string }) => { if (e.type === 'status' && e.message === 'Done') throw new Error('gone'); };
    await expect(createAI({ host, settingsDir: tmpDir(), providerOverride: m }).applyNote(dir, 'new caption', onEvent)).rejects.toThrow('gone');
    expect(await fsp.readFile(notes, 'utf8')).toBe('# v1\n\nFirst edit.\n');
    expect(await fsp.readFile(snapshot, 'utf8')).toBe(JSON.stringify(p));
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
