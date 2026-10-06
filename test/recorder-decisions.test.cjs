const test = require('node:test');
const assert = require('node:assert');

const { selectPasteText, isAbortError } = require('../backend/recorder-decisions.cjs');

test('pastes the transcript when translation is disabled', () => {
  assert.equal(
    selectPasteText({ translationEnabled: false, translation: 'hola', finalText: 'hello' }),
    'hello'
  );
});

test('pastes the translation when enabled and available', () => {
  assert.equal(
    selectPasteText({ translationEnabled: true, translation: 'hola', finalText: 'hello' }),
    'hola'
  );
});

test('falls back to the transcript when translation failed', () => {
  assert.equal(
    selectPasteText({ translationEnabled: true, translation: null, finalText: 'hello' }),
    'hello'
  );
});

test('detects abort via signal', () => {
  assert.equal(isAbortError(new Error('boom'), { aborted: true }), true);
});

test('detects AbortError by name', () => {
  const err = new Error('Transcription aborted');
  err.name = 'AbortError';
  assert.equal(isAbortError(err, { aborted: false }), true);
});

test('detects abort by message text', () => {
  assert.equal(isAbortError(new Error('Request aborted by user'), null), true);
});

test('tolerates a missing signal', () => {
  assert.equal(isAbortError(new Error('Request aborted'), null), true);
  assert.equal(isAbortError(new Error('boom'), null), false);
});

test('rejects ordinary failures', () => {
  assert.equal(isAbortError(new Error('whisper.cpp failed: exit code 1'), { aborted: false }), false);
  assert.equal(isAbortError(null, null), false);
});

