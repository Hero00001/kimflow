// test/i18n-model-auto-adversarial.test.cjs
//
// i18n surface of the Whisper(Cloud) -> Auto model rework and the placeholder
// mirroring:
//   - settings.model.auto exists in ALL locales with the right values
//   - settings.model.whisperCloud exists NOWHERE (locales + markup + source)
//   - index.html has no leftover "whisper" model option
//   - the key count stays 186
//   - every i18n key the placeholder mirroring can reference exists in all
//     three locales
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { loadTs } = require('./helpers/ts-loader.cjs');

const EN = loadTs('src/i18n/locales/en.ts').en;
const AR = loadTs('src/i18n/locales/ar.ts').ar;
const ZH = loadTs('src/i18n/locales/zh.ts').zh;
const LOCALES = { en: EN, ar: AR, zh: ZH };

test('settings.model.auto exists in en/ar/zh with the expected copy', () => {
  assert.equal(EN['settings.model.auto'], 'Auto (recommended)');
  assert.equal(AR['settings.model.auto'], 'تلقائي (مستحسن)');
  assert.equal(ZH['settings.model.auto'], '自动（推荐）');
});

test('settings.model.whisperCloud exists NOWHERE', () => {
  for (const [lang, locale] of Object.entries(LOCALES)) {
    assert.ok(!('settings.model.whisperCloud' in locale), `${lang} still defines settings.model.whisperCloud`);
  }
  // No reference anywhere in the markup or renderer source either.
  const haystacks = ['index.html', 'src/settings-form.ts', 'src/main.ts', 'src/dom.ts'];
  for (const file of haystacks) {
    const source = fs.readFileSync(path.resolve(file), 'utf8');
    assert.ok(!source.includes('whisperCloud'), `${file} still references settings.model.whisperCloud`);
  }
});

test('index.html offers exactly auto / nova-3 / nova-2 in the Deepgram model select', () => {
  const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
  const selectMatch = html.match(/<select id="deepgram-model-select">([\s\S]*?)<\/select>/);
  assert.ok(selectMatch, 'deepgram-model-select must exist');
  const values = [...selectMatch[1].matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, ['auto', 'nova-3', 'nova-2']);
  // And no whisper model option anywhere in the file.
  assert.ok(!/<option value="whisper"/.test(html), 'index.html still has a whisper model option');
});

test('the locale set is exactly en/ar/zh with 189 keys each (unchanged by the rework)', () => {
  assert.deepEqual(Object.keys(LOCALES).sort(), ['ar', 'en', 'zh']);
  // 186 + error.storage + warning.aiPolishFailed (B3) + settings.key.geminiRemoved (B9).
  assert.equal(Object.keys(EN).length, 189);
  assert.equal(Object.keys(AR).length, 189);
  assert.equal(Object.keys(ZH).length, 189);
});

test('every i18n key the placeholder mirroring can reference exists in all three locales', () => {
  // The states applyKeyPlaceholder mirrors, plus the fallback keys it reads
  // from data-i18n-placeholder (the three API key inputs).
  const required = [
    'settings.key.saved',
    'settings.key.volatile',
    'settings.key.unreadable',
    'settings.key.none',
    'settings.key.unavailable',
    'settings.key.deepgramPlaceholder',
    'settings.key.speechmaticsPlaceholder',
    'settings.key.geminiKeyPlaceholder',
  ];
  for (const key of required) {
    for (const [lang, locale] of Object.entries(LOCALES)) {
      assert.ok(typeof locale[key] === 'string' && locale[key].length > 0,
        `${lang} is missing the placeholder-mirror key ${key}`);
    }
  }
});
