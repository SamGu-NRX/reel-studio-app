import { afterEach, describe, expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { executeTool, newToolState, StyleStore, ToolContext } from '../src';
import { FakeHost, makeProject } from './helpers';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const { root, dir } = await makeProject({ lines: ['pagingtoken'], withAnalysis: false });
  roots.push(root);
  const ctx: ToolContext = {
    projectDir: dir, host: new FakeHost(root), style: new StyleStore(() => root),
    emit: () => {}, state: newToolState(), supportsImages: false,
  };
  return { ctx, root, dir };
}

async function readPages(ctx: ToolContext, name: string, args: Record<string, unknown> = {}) {
  let offset = 0;
  let full = '';
  for (let n = 0; n < 300; n++) {
    const result = await executeTool(ctx, name, { ...args, offset, limit: 601 });
    expect(result.isError).toBe(false);
    expect(Buffer.byteLength(result.content)).toBeLessThanOrEqual(64 * 1024);
    const parsed = JSON.parse(result.content);
    expect(parsed.page.offset).toBe(offset);
    expect(parsed.text.length).toBeLessThanOrEqual(601);
    full += parsed.text;
    if (parsed.page.nextOffset === null) {
      expect(full.length).toBe(parsed.page.total);
      return full;
    }
    expect(parsed.page.nextOffset).toBe(offset + parsed.text.length);
    offset = parsed.page.nextOffset;
  }
  throw new Error('Paging did not terminate');
}

describe('bounded read tools', () => {
  it('pages a long transcript without losing words, escaping, or the current cut', async () => {
    const { ctx, dir } = await fixture();
    const short = await executeTool(ctx, 'get_transcript', {});
    expect(short.isError).toBe(false);
    const payload = 'abc\u0000"\\🦊'.repeat(4000);
    const transcriptFile = path.join(dir, 'work', 'transcript.json');
    const transcript = JSON.parse(await fsp.readFile(transcriptFile, 'utf8'));
    transcript.words[0].w = payload;
    await fsp.writeFile(transcriptFile, JSON.stringify(transcript));
    ctx.transcript = undefined;

    const first = await executeTool(ctx, 'get_transcript', {});
    expect(first.isError).toBe(false);
    expect(Buffer.byteLength(first.content)).toBeLessThanOrEqual(64 * 1024);
    const page = JSON.parse(first.content);
    expect(page.text.length).toBe(8192);
    expect(page.page.nextOffset).toBe(8192);
    expect(await readPages(ctx, 'get_transcript')).toBe(short.content.replace('w0:pagingtoken', `w0:${payload}`));
  });

  it('pages a large project view and preserves the complete JSON', async () => {
    const { ctx, dir } = await fixture();
    const projectFile = path.join(dir, 'project.json');
    const project = JSON.parse(await fsp.readFile(projectFile, 'utf8'));
    project.title = 'title '.repeat(4000);
    await fsp.writeFile(projectFile, JSON.stringify(project));
    const first = await executeTool(ctx, 'get_project', {});
    expect(JSON.parse(first.content).page.nextOffset).toBe(8192);
    expect(JSON.parse(await readPages(ctx, 'get_project')).title).toBe(project.title);
  });

  it('pages a large library without dropping or repeating files', async () => {
    const { ctx, root } = await fixture();
    const names = Array.from({ length: 90 }, (_, n) => `${String(n).padStart(3, '0')}-${'x'.repeat(180)}.png`);
    await Promise.all(names.map((name) => fsp.writeFile(path.join(root, 'Library', 'Images', name), 'image')));
    const first = await executeTool(ctx, 'list_library', { kind: 'images' });
    expect(JSON.parse(first.content).page.nextOffset).toBe(8192);
    const library = JSON.parse(await readPages(ctx, 'list_library', { kind: 'images' }));
    expect(library.files).toEqual(names.map((name) => `Library/Images/${name}`));
  });

  it.each([
    [{ offset: -1 }, /offset.*must be >= 0/],
    [{ offset: 0.5 }, /offset.*expected integer/],
    [{ limit: 0 }, /limit.*must be >= 1/],
    [{ limit: 8193 }, /limit.*must be <= 8192/],
    [{ limit: 1.5 }, /limit.*expected integer/],
    [{ offset: Number.MAX_SAFE_INTEGER }, /offset.*exceeds.*length/],
  ])('rejects invalid paging %j with a specific error', async (args, error) => {
    const { ctx } = await fixture();
    const result = await executeTool(ctx, 'get_transcript', args);
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(error);
  });

  it('returns an empty terminal page when the offset equals the full length', async () => {
    const { ctx } = await fixture();
    const short = await executeTool(ctx, 'get_transcript', {});
    const result = await executeTool(ctx, 'get_transcript', { offset: short.content.length });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({
      text: '', page: { offset: short.content.length, limit: 8192, total: short.content.length, nextOffset: null },
    });
  });
});
