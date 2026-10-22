'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {instrument} = require('./metrics.cjs');

function error(message) { return {isError: true, content: JSON.stringify({error: message})}; }

test('a repaired guardrail rejection is reported separately and does not fail reliability', async () => {
  const results = [error('stat-count-up: shorten it'), {isError: false, content: '{}'}];
  const tools = {executeTool: async () => results.shift()};
  const m = instrument({runAgent: async () => ({})}, tools).start('note');
  await tools.executeTool({}, 'add_broll', {});
  await tools.executeTool({}, 'add_broll', {params: {text: 'short'}});
  assert.equal(m.repairedGuardrailErrors.length, 1);
  assert.equal(m.unrepairedGuardrailErrors.length, 0);
});

test('an unrepaired guardrail rejection remains a reliability failure', async () => {
  const tools = {executeTool: async () => error('render_draft: No more previews for this task')};
  const m = instrument({runAgent: async () => ({})}, tools).start('firstEdit');
  await tools.executeTool({}, 'render_draft', {});
  assert.equal(m.repairedGuardrailErrors.length, 0);
  assert.equal(m.unrepairedGuardrailErrors.length, 1);
});
