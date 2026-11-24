'use strict';
// test/vocab-chips.test.cjs
//
// The pure vocab chip helpers (src/vocab.ts). Regression coverage for the QA
// fix: chips used to splice the textarea value by the FILTERED term index, so
// with any blank line present ('alpha\n\nbeta') removing chip 'beta' (filtered
// index 1) deleted the empty line instead, leaving 'beta' as an unremovable
// ghost chip. Chips now carry their RAW line index and removal splices by it.

const test = require('node:test');
const assert = require('node:assert');
const { loadTs } = require('./helpers/ts-loader.cjs');

const { parseVocabChips, removeVocabLine } = loadTs('src/vocab.ts');

const split = (value) => value.split('\n');

test('parseVocabChips skips blank lines but keeps their raw indices', () => {
  const chips = parseVocabChips(split('alpha\n\nbeta'));
  assert.deepEqual(chips, [
    { term: 'alpha', lineIndex: 0 },
    { term: 'beta', lineIndex: 2 },
  ]);
});

test('parseVocabChips trims term-bearing lines', () => {
  const chips = parseVocabChips(split('  alpha  \nbeta'));
  assert.deepEqual(chips.map((chip) => chip.term), ['alpha', 'beta']);
  assert.deepEqual(chips.map((chip) => chip.lineIndex), [0, 1]);
});

test('a trailing newline yields no phantom chip', () => {
  assert.deepEqual(parseVocabChips(split('alpha\n')), [{ term: 'alpha', lineIndex: 0 }]);
  assert.deepEqual(parseVocabChips(split('')), []);
  assert.deepEqual(parseVocabChips(split('\n\n')), []);
});

test('duplicate terms each get their own chip with a distinct raw index', () => {
  const chips = parseVocabChips(split('alpha\nalpha'));
  assert.deepEqual(chips, [
    { term: 'alpha', lineIndex: 0 },
    { term: 'alpha', lineIndex: 1 },
  ]);
});

test('removing a chip after a blank line deletes the RIGHT raw line (the ghost-chip bug)', () => {
  const lines = split('alpha\n\nbeta');
  const next = removeVocabLine(lines, 2); // 'beta' sits at raw index 2
  assert.deepEqual(next.join('\n'), 'alpha\n');
  // And the surviving chip list no longer contains beta at any index.
  assert.deepEqual(parseVocabChips(next), [{ term: 'alpha', lineIndex: 0 }]);
});

test('removing a term before a blank line keeps the blank line (raw indices, not compacted)', () => {
  const next = removeVocabLine(split('alpha\n\nbeta'), 0);
  assert.deepEqual(next.join('\n'), '\nbeta');
  assert.deepEqual(parseVocabChips(next), [{ term: 'beta', lineIndex: 1 }]);
});

test('removing the only line empties the textarea value', () => {
  assert.deepEqual(removeVocabLine(split('alpha'), 0), []);
});

test('an out-of-range or non-integer index is a no-op copy (stale chip click)', () => {
  const lines = split('alpha\nbeta');
  assert.deepEqual(removeVocabLine(lines, 5), ['alpha', 'beta']);
  assert.deepEqual(removeVocabLine(lines, -1), ['alpha', 'beta']);
  assert.deepEqual(removeVocabLine(lines, 1.5), ['alpha', 'beta']);
  assert.deepEqual(removeVocabLine(lines, NaN), ['alpha', 'beta']);
  // And the input array is never mutated.
  assert.deepEqual(lines, ['alpha', 'beta']);
});

test('a 200-char term survives parse + removal untouched', () => {
  const long = 'x'.repeat(200);
  const lines = split(`${long}\nshort`);
  const chips = parseVocabChips(lines);
  assert.equal(chips[0].term.length, 200);
  assert.deepEqual(removeVocabLine(lines, chips[1].lineIndex).join('\n'), long);
});
