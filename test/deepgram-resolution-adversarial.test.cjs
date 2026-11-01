// test/deepgram-resolution-adversarial.test.cjs
//
// Property-style sweeps over resolveDeepgramModel / deepgramOptions beyond the
// behaviour table in deepgram-model.test.cjs. The two invariants that matter
// on the wire:
//   1. `detect_language` NEVER coexists with a `language` key in one request
//      (nova-2's auto mode is detect_language, nova-3's is language=multi —
//      mixing them is what the old language=multi-for-nova-2 bug did).
//   2. the removed 'whisper' model NEVER reaches any output.
const test = require('node:test');
const assert = require('node:assert');
const deepgram = require('../backend/engines/deepgram.cjs');
const { deepgramVocabParams } = require('../backend/vocabulary.cjs');
const settings = require('../backend/settings.cjs');

const LANGUAGES = [
  'auto', '', undefined, null, 42,
  ...deepgram.NOVA3_LANGUAGES,
  'ar', 'ko', 'tr', 'zh', 'fa', 'id', 'sv', 'uk', 'pl', 'he', 'el',
  'EN', ' ES ', '  ru  ', 'klingon', 'en-US', 'zh-CN',
];
const MODELS = ['auto', 'nova-3', 'nova-2', 'whisper', 'turbo', '', undefined, null, 'NOVA-2'];

/** The specific languages the sweep uses as "outside the Nova 3 set" probes. */
const OUTSIDE_LANGUAGES = ['ar', 'ko', 'tr', 'zh', 'fa', 'id', 'sv', 'uk', 'pl', 'he', 'el', 'klingon'];

test('invariant sweep: detect_language and language never coexist in deepgramOptions', () => {
  for (const language of LANGUAGES) {
    for (const model of MODELS) {
      const options = deepgram.deepgramOptions(language, model);
      const hasLang = Object.prototype.hasOwnProperty.call(options, 'language');
      const hasDetect = Object.prototype.hasOwnProperty.call(options, 'detect_language');
      assert.ok(!(hasLang && hasDetect),
        `language=${JSON.stringify(language)} model=${JSON.stringify(model)} produced both keys: ${JSON.stringify(options)}`);
    }
  }
});

test('invariant sweep: "whisper" never appears in any resolved model or options', () => {
  for (const language of LANGUAGES) {
    for (const model of MODELS) {
      const resolved = deepgram.resolveDeepgramModel(language, model);
      assert.notEqual(resolved.model, 'whisper');
      assert.ok(!String(resolved.model).includes('whisper'));
      const options = deepgram.deepgramOptions(language, model);
      assert.notEqual(options.model, 'whisper');
    }
  }
});

test('invariant sweep: every resolution produces a concrete nova model with a language config', () => {
  for (const language of LANGUAGES) {
    for (const model of MODELS) {
      const resolved = deepgram.resolveDeepgramModel(language, model);
      assert.ok(resolved.model === 'nova-3' || resolved.model === 'nova-2',
        `language=${JSON.stringify(language)} model=${JSON.stringify(model)} -> ${JSON.stringify(resolved)}`);
      const hasLang = Object.prototype.hasOwnProperty.call(resolved, 'language');
      const hasDetect = Object.prototype.hasOwnProperty.call(resolved, 'detect_language');
      assert.ok(hasLang !== hasDetect || (hasLang && resolved.language !== 'multi'),
        `exactly one language config expected, got ${JSON.stringify(resolved)}`);
    }
  }
});

test('every Nova 3 language with stored model auto resolves to nova-3', () => {
  for (const language of deepgram.NOVA3_LANGUAGES) {
    const resolved = deepgram.resolveDeepgramModel(language, 'auto');
    assert.deepEqual(resolved, { model: 'nova-3', language },
      `language "${language}" must stay on nova-3`);
    const options = deepgram.deepgramOptions(language, 'auto');
    assert.equal(options.model, 'nova-3');
    assert.equal(options.language, language);
    assert.ok(!('detect_language' in options));
  }
});

test('languages outside the Nova 3 set fall back to nova-2 with an explicit language', () => {
  for (const language of OUTSIDE_LANGUAGES) {
    const resolved = deepgram.resolveDeepgramModel(language, 'auto');
    assert.deepEqual(resolved, { model: 'nova-2', language },
      `language "${language}" must fall back to nova-2`);
    const options = deepgram.deepgramOptions(language, 'auto');
    assert.equal(options.model, 'nova-2');
    assert.equal(options.language, language);
    assert.ok(!('detect_language' in options), 'a SPECIFIC language never uses detect_language');
  }
});

test('case and whitespace DO normalize into the Nova 3 set (pinned actual behaviour)', () => {
  // 'EN' and ' ES ' are normalized (trim + lowercase) BEFORE the set lookup,
  // so they resolve like 'en'/'es' — nova-3. This is deliberate tolerance,
  // not a fall-through to nova-2.
  assert.deepEqual(deepgram.resolveDeepgramModel('EN', 'auto'), { model: 'nova-3', language: 'en' });
  assert.deepEqual(deepgram.resolveDeepgramModel(' ES ', 'auto'), { model: 'nova-3', language: 'es' });
});

test('nova-2 + auto uses detect_language and NEVER language=multi (the API-rejecting combo)', () => {
  const options = deepgram.deepgramOptions('auto', 'nova-2');
  assert.equal(options.detect_language, true);
  assert.ok(!('language' in options));
  assert.equal(options.model, 'nova-2');
  // Same shape through the resolver.
  assert.deepEqual(deepgram.resolveDeepgramModel('auto', 'nova-2'), { model: 'nova-2', detect_language: true });
});

test('nova-3 + auto uses language=multi and NEVER detect_language', () => {
  const options = deepgram.deepgramOptions('auto', 'nova-3');
  assert.equal(options.language, 'multi');
  assert.ok(!('detect_language' in options));
  assert.equal(options.model, 'nova-3');
});

test('vocab params key off the RESOLVED model: same stored auto, ar vs en diverge', () => {
  const arResolved = deepgram.resolveDeepgramModel('ar', 'auto');
  const enResolved = deepgram.resolveDeepgramModel('en', 'auto');
  assert.equal(arResolved.model, 'nova-2');
  assert.equal(enResolved.model, 'nova-3');
  const vocab = ['KimFlow', 'Deepgram'];
  // nova-2 uses weighted keywords, nova-3 uses plain keyterm.
  assert.deepEqual(deepgramVocabParams(arResolved.model, vocab), {
    keywords: ['KimFlow:2', 'Deepgram:2'],
  });
  assert.deepEqual(deepgramVocabParams(enResolved.model, vocab), { keyterm: vocab });
});

test('settings: NOVA-2 (uppercase) is not whitelisted and coerces to auto (pinned actual behaviour)', () => {
  // The whitelist is exactly ['auto','nova-3','nova-2'] — case-sensitive by
  // design. An uppercase stored value cannot come from the dropdown, so it
  // is treated as unknown and reset to the default. Pinned so a future
  // case-insensitive relaxation is a conscious change, not an accident.
  assert.equal(settings.normalizeSettings({ deepgramModel: 'NOVA-2' }).deepgramModel, 'auto');
  assert.equal(settings.normalizeSettings({ deepgramModel: 'Nova-3' }).deepgramModel, 'auto');
});

test('settings: the full coercion table for deepgramModel', () => {
  for (const [input, expected] of [
    ['whisper', 'auto'],
    ['turbo', 'auto'],
    ['', 'auto'],
    [42, 'auto'],
    [null, 'auto'],
    [undefined, 'auto'],
    ['auto', 'auto'],
    ['nova-3', 'nova-3'],
    ['nova-2', 'nova-2'],
  ]) {
    assert.equal(settings.normalizeSettings({ deepgramModel: input }).deepgramModel, expected,
      `deepgramModel=${JSON.stringify(input)} must normalize to ${expected}`);
  }
  // The default settings object itself carries 'auto'.
  assert.equal(settings.DEFAULT_SETTINGS.deepgramModel, 'auto');
});
