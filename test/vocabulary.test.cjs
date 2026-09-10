const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeVocabulary,
  deepgramVocabParams,
  speechmaticsVocab,
  whisperPrompt,
} = require('../backend/vocabulary.cjs');

test('normalizes a pasted word list', () => {
  assert.deepEqual(normalizeVocabulary(['  KimFlow ', '', 'Ahmed', 'KimFlow']), ['KimFlow', 'Ahmed', 'KimFlow']);
  assert.equal(normalizeVocabulary('not-an-array').length, 0);
  assert.equal(normalizeVocabulary(new Array(150).fill('x')).length, 100);
});

test('maps to Deepgram params per model', () => {
  assert.deepEqual(deepgramVocabParams('nova-3', ['KimFlow']), { keyterm: ['KimFlow'] });
  assert.deepEqual(deepgramVocabParams('nova-2', ['KimFlow']), { keywords: ['KimFlow:2'] });
  assert.deepEqual(deepgramVocabParams('whisper', ['KimFlow']), {});
  assert.deepEqual(deepgramVocabParams('nova-3', []), {});
});

test('maps to Speechmatics and whisper prompt', () => {
  assert.deepEqual(speechmaticsVocab(['gnocchi']), [{ content: 'gnocchi' }]);
  assert.deepEqual(speechmaticsVocab([]), []);
  assert.equal(whisperPrompt(['KimFlow', 'Ahmed']), 'KimFlow Ahmed');
  assert.equal(whisperPrompt([]), '');
});
