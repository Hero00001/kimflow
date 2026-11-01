// test/deepgram-model.test.cjs
//
// The stored Deepgram model is no longer the model sent to the API. The
// setting 'auto' (and the legacy removed 'whisper') resolves per request via
// resolveDeepgramModel, and nova-2 must NEVER be sent language=multi (it
// fails or produces garbage) — its auto mode is detect_language=true.
const test = require('node:test');
const assert = require('node:assert');
const deepgram = require('../backend/engines/deepgram.cjs');
const { deepgramVocabParams } = require('../backend/vocabulary.cjs');
const settings = require('../backend/settings.cjs');

// ── resolveDeepgramModel behaviour table ────────────────────────────────────

test('input auto + model auto resolves to nova-3 with language=multi', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('auto', 'auto'), { model: 'nova-3', language: 'multi' });
});

test('input auto + model nova-2 resolves to nova-2 with detect_language (never multi)', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('auto', 'nova-2'), { model: 'nova-2', detect_language: true });
});

test('input auto + model nova-3 resolves to nova-3 with language=multi', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('auto', 'nova-3'), { model: 'nova-3', language: 'multi' });
});

test('a specific Nova 3 language with model auto resolves to nova-3', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('en', 'auto'), { model: 'nova-3', language: 'en' });
  assert.deepEqual(deepgram.resolveDeepgramModel('es', 'nova-3'), { model: 'nova-3', language: 'es' });
  assert.deepEqual(deepgram.resolveDeepgramModel('ja', 'auto'), { model: 'nova-3', language: 'ja' });
});

test('a language outside the Nova 3 set with model auto falls back to nova-2', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('ar', 'auto'), { model: 'nova-2', language: 'ar' });
  assert.deepEqual(deepgram.resolveDeepgramModel('ko', 'auto'), { model: 'nova-2', language: 'ko' });
  assert.deepEqual(deepgram.resolveDeepgramModel('tr', 'nova-2'), { model: 'nova-2', language: 'tr' });
});

test('nova-2 with a specific language sends that language', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('ar', 'nova-2'), { model: 'nova-2', language: 'ar' });
  assert.deepEqual(deepgram.resolveDeepgramModel('en', 'nova-2'), { model: 'nova-2', language: 'en' });
});

test('the legacy whisper model value resolves like auto (smart fallback)', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('auto', 'whisper'), { model: 'nova-3', language: 'multi' });
  assert.deepEqual(deepgram.resolveDeepgramModel('en', 'whisper'), { model: 'nova-3', language: 'en' });
  assert.deepEqual(deepgram.resolveDeepgramModel('ar', 'whisper'), { model: 'nova-2', language: 'ar' });
  assert.deepEqual(deepgram.resolveDeepgramModel('ko', 'whisper'), { model: 'nova-2', language: 'ko' });
});

test('an unknown model value falls back like auto', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('en', 'turbo'), { model: 'nova-3', language: 'en' });
  assert.deepEqual(deepgram.resolveDeepgramModel('ar', 'turbo'), { model: 'nova-2', language: 'ar' });
});

test('a garbage language passes through to nova-2 (the API rejects it visibly)', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('klingon', 'auto'), { model: 'nova-2', language: 'klingon' });
});

test('language matching is case-insensitive and whitespace-tolerant', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('EN', 'auto'), { model: 'nova-3', language: 'en' });
  assert.deepEqual(deepgram.resolveDeepgramModel(' AR ', 'nova-2'), { model: 'nova-2', language: 'ar' });
});

test('an empty or non-string language is treated as auto', () => {
  assert.deepEqual(deepgram.resolveDeepgramModel('', 'auto'), { model: 'nova-3', language: 'multi' });
  assert.deepEqual(deepgram.resolveDeepgramModel(undefined, 'auto'), { model: 'nova-3', language: 'multi' });
  assert.deepEqual(deepgram.resolveDeepgramModel(null, 'nova-2'), { model: 'nova-2', detect_language: true });
});

test('NOVA3_LANGUAGES matches the documented single-language set', () => {
  assert.deepEqual([...deepgram.NOVA3_LANGUAGES].sort(), ['de', 'en', 'es', 'fr', 'hi', 'it', 'ja', 'nl', 'pt', 'ru']);
});

// ── deepgramOptions ─────────────────────────────────────────────────────────

test('deepgramOptions carries the resolved model and language config', () => {
  assert.deepEqual(deepgram.deepgramOptions('auto', 'auto'), {
    model: 'nova-3', language: 'multi', smart_format: true, numerals: true,
  });
  assert.deepEqual(deepgram.deepgramOptions('auto', 'nova-2'), {
    model: 'nova-2', detect_language: true, smart_format: true, numerals: true,
  });
  assert.deepEqual(deepgram.deepgramOptions('ar', 'whisper'), {
    model: 'nova-2', language: 'ar', smart_format: true, numerals: true,
  });
});

test('deepgramVocabParams receives the RESOLVED model', () => {
  const resolved = deepgram.resolveDeepgramModel('ar', 'auto');
  assert.deepEqual(deepgramVocabParams(resolved.model, ['KimFlow']), { keywords: ['KimFlow:2'] });
  const resolvedEn = deepgram.resolveDeepgramModel('en', 'auto');
  assert.deepEqual(deepgramVocabParams(resolvedEn.model, ['KimFlow']), { keyterm: ['KimFlow'] });
  // The raw stored 'auto' setting must NOT be passed to vocab params.
  assert.deepEqual(deepgramVocabParams('auto', ['KimFlow']), {});
});

// ── settings normalization (whisper → auto migration) ───────────────────────

test('a stored whisper model normalizes to auto', () => {
  assert.equal(settings.normalizeSettings({ deepgramModel: 'whisper' }).deepgramModel, 'auto');
});

test('the settings default is auto and unknown values coerce to auto', () => {
  assert.equal(settings.DEFAULT_SETTINGS.deepgramModel, 'auto');
  assert.equal(settings.normalizeSettings({}).deepgramModel, 'auto');
  assert.equal(settings.normalizeSettings({ deepgramModel: 'turbo' }).deepgramModel, 'auto');
});

test('explicit nova-3 / nova-2 selections survive normalization', () => {
  assert.equal(settings.normalizeSettings({ deepgramModel: 'nova-3' }).deepgramModel, 'nova-3');
  assert.equal(settings.normalizeSettings({ deepgramModel: 'nova-2' }).deepgramModel, 'nova-2');
});
