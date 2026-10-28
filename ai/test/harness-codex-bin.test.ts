// The dev MCP harness (mcp-harness-2) and #90's codex-cli editor find the person's `codex` one way: localCodex.ts.
import { expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createAI } from '../src';
import { FakeHost, makeProject, tmpDir } from './helpers';

it.skipIf(process.platform === 'win32')('fails if the dev Codex harness runs a codex other than the one detection found', async () => {
  const dir = tmpDir('codex bin ');
  const ran = path.join(dir, 'ran');
  // a stand-in codex that writes down its arguments and fails, so the note ends at once
  const bin = path.join(dir, 'my codex');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> '${ran}'\nexit 1\n`, { mode: 0o755 });
  const settingsDir = tmpDir('settings ');
  fs.writeFileSync(path.join(settingsDir, 'ai-settings.json'), JSON.stringify({ active: 'codex-cli', harness: 'codex' }));
  const { root, dir: project } = await makeProject();
  const ai = createAI({
    host: new FakeHost(root), settingsDir, dev: true,
    localCodex: { bin, run: async (_cmd, args) => ({ code: 0, stdout: args[0] === '--version' ? 'codex-cli 0.164.0' : 'Logged in using ChatGPT', stderr: '' }) },
  });
  // no other codex on PATH, and none of this machine's
  const pathBefore = process.env.PATH;
  process.env.PATH = tmpDir('empty path ');
  try {
    await ai.applyNote(project, 'open with the part about the starter, it is the strongest bit', () => undefined).catch(() => undefined);
  } finally {
    process.env.PATH = pathBefore;
  }
  // --strict-config is the harness's own argument; the text fallback runs `codex exec` without it
  expect(fs.readFileSync(ran, 'utf8')).toContain('--strict-config');
});
