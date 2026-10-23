import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { CUT_STYLES } from '../src/cut-style';

it('keeps the AI cut vocabulary identical to the engine table', () => {
  const engine = path.resolve(__dirname, '../../engine');
  const table = execFileSync('python3', ['-c', 'import json; from reelengine.cut_style import CUT_STYLES; print(json.dumps(CUT_STYLES))'],
    { cwd: engine, encoding: 'utf8' });
  expect(CUT_STYLES).toEqual(JSON.parse(table));
});
