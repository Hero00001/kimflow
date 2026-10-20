// test/speechmatics-language.test.cjs
//
// Speechmatics Batch supports `language: "auto"` (Language Identification).
// KimFlow forced `en` whenever the input language was Auto Detect — which is
// the app's DEFAULT input language — so every Speechmatics transcription was
// forced to English and non-English speech came back as English gibberish.
//
// The Deepgram engine handles the same case with `multi`.
const test = require('node:test');
const assert = require('node:assert');
const { speechmaticsConfig } = require('../backend/engines/speechmatics.cjs');

test('auto detect is passed through to Speechmatics', () => {
  assert.equal(speechmaticsConfig('auto').language, 'auto');
});

test('an explicit language is passed through unchanged', () => {
  assert.equal(speechmaticsConfig('fr').language, 'fr');
  assert.equal(speechmaticsConfig('en').language, 'en');
});

test('an empty language falls back to auto detect', () => {
  assert.equal(speechmaticsConfig('').language, 'auto');
  assert.equal(speechmaticsConfig(undefined).language, 'auto');
});

test('the config carries the custom vocabulary when present', () => {
  const config = speechmaticsConfig('auto', ['KimFlow']);
  assert.deepEqual(config.additional_vocab, [{ content: 'KimFlow' }]);
  assert.equal(speechmaticsConfig('auto', []).additional_vocab, undefined);
});
