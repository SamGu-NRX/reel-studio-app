'use strict';

function normalize(value) {
  return String(value).toLowerCase().replace(/[“”"'.,!?;:()[\]{}]/g, '').trim();
}

function keptIds(project, words) {
  const ranges = project?.cut?.keep || [];
  const index = new Map(words.map((word, i) => [word.id, i]));
  const kept = new Set();
  for (const range of ranges) {
    const from = index.get(range.from);
    const to = index.get(range.to);
    if (from === undefined || to === undefined || from > to) continue;
    for (let i = from; i <= to; i++) kept.add(words[i].id);
  }
  return kept;
}

function targetPhrases(note) {
  if (Array.isArray(note.targetWords)) return [{ids: note.targetWords}];
  const explicit = typeof note.targetPhrase === 'string' ? [note.targetPhrase] : [];
  const quoted = [...String(note.text || '').matchAll(/["“”]([^"“”]+)["“”]/g)].map(match => match[1]);
  return [...explicit, ...quoted].map(text => ({words: text.split(/\s+/).map(normalize).filter(Boolean)}));
}

function checkNoteBaseline(project, words, note) {
  const kept = keptIds(project, words);
  for (const target of targetPhrases(note)) {
    if (target.ids) {
      if (!target.ids.every(id => kept.has(id))) return {valid: false, reason: 'target phrase is not present in baseline kept words'};
      continue;
    }
    const phrase = target.words;
    if (!phrase.length) continue;
    const keptWords = words.filter(word => kept.has(word.id)).map(word => normalize(word.w));
    const found = keptWords.some((_, start) => phrase.every((word, offset) => keptWords[start + offset] === word));
    if (!found) return {valid: false, reason: 'target phrase is not present in baseline kept words'};
  }
  return {valid: true};
}

module.exports = {checkNoteBaseline};
