'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {check} = require('./scope.cjs');
const {instrument} = require('./metrics.cjs');

const words = Array.from({length: 10}, (_, i) => ({id: `w${i}`, w: `word${i}`, s: i, e: i + 0.5, source: 's1'}));
const card = (id, from, to, text) => ({id, anchor: {from, to}, leadIn: 0.13, treatment: 'text-pop', asset: null, params: {text}});
const before = {
  cut: {keep: [{from: 'w0', to: 'w9'}]},
  broll: [card('b1', 'w0', 'w2', 'Intro'), card('b5', 'w7', 'w9', 'Closing'), card('b6', 'w3', 'w4', 'Middle')],
  zooms: [{anchor: {from: 'w5', to: 'w8'}, scale: 1.1}],
};
const cutEnding = {...before, cut: {keep: [{from: 'w0', to: 'w6'}]}};

test('cutting the ending may remove or re-anchor what sat on the cut words', () => {
  const after = {...cutEnding, broll: [before.broll[0], before.broll[2]], zooms: [{anchor: {from: 'w5', to: 'w6'}, scale: 1.1}]};
  const s = check(before, after, words, ['/cut/keep']);
  assert.deepEqual(s.unexpected, []);
  assert.deepEqual([...new Set(s.consequences.map(x => x.path.split('/').slice(0, 3).join('/')))], ['/broll/1', '/zooms/0']);
});

test('changes beyond that cleanup stay out of scope', () => {
  const after = {...cutEnding,
    broll: [before.broll[0], before.broll[1], {...before.broll[2], params: {text: 'Changed'}}],
    zooms: [{anchor: {from: 'w5', to: 'w6'}, scale: 1.4}]};
  const s = check(before, after, words, ['/cut/keep']);
  assert.deepEqual(s.unexpected.map(x => x.path), ['/broll/2/params/text', '/zooms/0/scale']);
});

test('a tool the harness host cannot run is not scored as a model error', async () => {
  const tools = {executeTool: async () => ({isError: true, content: JSON.stringify({error: 'add_broll failed: Animations are only available in the app. Use a text card instead.', code: 'NO_ANIMATION_RENDERER'})})};
  const m = instrument({runAgent: async () => ({})}, tools).start('firstEdit');
  await tools.executeTool({}, 'add_broll', {});
  assert.equal(m.environmentErrors.length, 1);
  assert.equal(m.executionErrors.length + m.validationErrors.length, 0);
});
