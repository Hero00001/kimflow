const test = require('node:test');
const assert = require('node:assert');

const { selectPasteText, isAbortError, awaitAbortable } = require('../backend/recorder-decisions.cjs');

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

test('message text is NOT an abort signal (A4/F-15)', () => {
  // The old /abort/i message match swallowed real provider failures like
  // "Deepgram request aborted by peer (HTTP 502)" as silent cancellations.
  assert.equal(isAbortError(new Error('Request aborted by user'), null), false);
  assert.equal(isAbortError(new Error('Deepgram request aborted by peer (HTTP 502)'), { aborted: false }), false);
});

test('tolerates a missing signal', () => {
  assert.equal(isAbortError(new Error('Request aborted'), null), false);
  assert.equal(isAbortError(new Error('boom'), null), false);
});

test('rejects ordinary failures', () => {
  assert.equal(isAbortError(new Error('whisper.cpp failed: exit code 1'), { aborted: false }), false);
  assert.equal(isAbortError(null, null), false);
});


test('awaitAbortable passes resolution through', async () => {
  const controller = new AbortController();
  assert.equal(await awaitAbortable(Promise.resolve('ok'), controller.signal), 'ok');
});

test('awaitAbortable passes through without a signal', async () => {
  assert.equal(await awaitAbortable(Promise.resolve('ok'), undefined), 'ok');
});

test('awaitAbortable rejects with AbortError on abort', async () => {
  const controller = new AbortController();
  const pending = new Promise(() => {});
  const failed = assert.rejects(awaitAbortable(pending, controller.signal), (error) => error.name === 'AbortError');
  controller.abort();
  await failed;
});

test('awaitAbortable throws immediately when already aborted', () => {
  const controller = new AbortController();
  controller.abort();
  assert.throws(() => awaitAbortable(Promise.resolve('x'), controller.signal), (error) => error.name === 'AbortError');
});

