import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createAI } from '../src';
import { call, FakeHost, firstVersion, makeProject, ScriptedModel, tmpDir } from './helpers';

const finish = { toolCalls: [call('finish', { summary_for_user: 'Done.' })] };
const change = () => new ScriptedModel([{ toolCalls: [call('set_gap_cap', { seconds: 0.5 })] }, finish]);

// A real Windows handle (read share, no delete share), as a virus scanner opens a file it just saw written.
// Resolves once the file is held; `released` settles when the handle closes.
function hold(file: string, ms: number): Promise<{ released: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-Command',
      `$f = [IO.File]::Open('${file.replace(/'/g, "''")}', 'Open', 'Read', 'ReadWrite'); 'held'; Start-Sleep -Milliseconds ${ms}; $f.Close()`]);
    const released = new Promise<void>((r) => ps.on('exit', () => r()));
    ps.stdout.on('data', (d) => d.toString().includes('held') && resolve({ released }));
    ps.on('error', reject);
  });
}

describe.runIf(process.platform === 'win32')('branch notes on Windows', () => {
  it('a failed branch final removes its unpublished version while a scanner still holds its video for a moment', { timeout: 30_000 }, async () => {
    const { root, dir } = await makeProject();
    await fs.writeFile(path.join(dir, 'media', 'take01.mp4'), 'source');
    const host = new FakeHost(root);
    await firstVersion(dir, host);
    const file = path.join(dir, 'project.json');
    const p = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const gapCap of [0.4, 0.7]) {
      p.cut.gapCap = gapCap;
      await fs.writeFile(file, JSON.stringify(p));
      p.version = (await host.runEngine('render', ['--project', dir])).version;
    }
    await fs.writeFile(file, JSON.stringify(p));
    let released: Promise<void> | undefined;
    host.afterRenderFiles = async ({ draft, dir: vd }) => {
      if (draft) return;
      ({ released } = await hold(path.join(vd, 'export.mp4'), 800));
      throw { code: 'RENDER_FAILED' };
    };
    await expect(createAI({ host, settingsDir: tmpDir('held settings '), providerOverride: change() })
      .applyNote(dir, 'give pauses more room', () => undefined, undefined, { base: 2 }))
      .rejects.toMatchObject({ code: 'RENDER_FAILED' });
    await released;
    expect((await fs.readdir(path.join(dir, 'versions'))).sort()).toEqual(['v1', 'v2', 'v3']);
  });
});
