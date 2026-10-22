'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {checkNoteBaseline} = require('./baseline.cjs');

const words = ['keep', 'this', 'part', 'then', 'cut', 'the', 'rest'].map((w, i) => ({id: `w${i}`, w}));
const project = {cut: {keep: [{from: 'w0', to: 'w3'}, {from: 'w6', to: 'w6'}]}};

test('a note targeting a phrase already cut is invalid, not a model failure', () => {
  const result = checkNoteBaseline(project, words, {text: 'Cut everything from "cut the rest" to the end.'});
  assert.deepEqual(result, {valid: false, reason: 'target phrase is not present in baseline kept words'});
});

test('a note targeting kept words remains valid', () => {
  const result = checkNoteBaseline(project, words, {text: 'Cut everything from "keep this part" to the end.'});
  assert.deepEqual(result, {valid: true});
});

test('manifest targetWords can name a non-contiguous kept phrase', () => {
  const result = checkNoteBaseline(project, words, {targetWords: ['w0', 'w1', 'w2']});
  assert.deepEqual(result, {valid: true});
});
