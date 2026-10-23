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

it('rejects malformed preset values in both project validators', async () => {
  const { validateProject, withDefaults } = await import('../src/project');
  const cases = ['clean', 'standard', 'hyper', 'punchline', ['clean'], ['standard'], [], {}, null, 1, true, 'toString', 'unknown'];
  const python = execFileSync('uv', ['run', '--no-project', '--python', '3.11', '--with-editable', './engine[dev]', 'python', '-c',
    'import json, sys; from reelengine import project; cases=json.load(sys.stdin); print(json.dumps([not project.validate(dict(project.new_project("t"), cutStyle={"preset": value, "seed": 1})) for value in cases]))'],
    { cwd: path.resolve(__dirname, '../..'), input: JSON.stringify(cases), encoding: 'utf8' });
  const expected = [true, true, true, true, false, false, false, false, false, false, false, false, false];
  expect(JSON.parse(python)).toEqual(expected);
  expect(cases.map((preset) => validateProject({ ...withDefaults({}), cutStyle: { preset, seed: 1 } }).length === 0)).toEqual(expected);
});
