'use strict';
// Ticket 06 categories 1-3: locale parity, placeholder parity, fallback.
//
// The locale files are TypeScript; `test/helpers/ts-loader.cjs` transpiles them
// in-memory so the plain `node --test` runner can exercise the real data.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { loadTs } = require('./helpers/ts-loader.cjs');

const EN = loadTs('src/i18n/locales/en.ts').en;
const AR = loadTs('src/i18n/locales/ar.ts').ar;
const ZH = loadTs('src/i18n/locales/zh.ts').zh;

const LOCALES = { en: EN, ar: AR, zh: ZH };
const PLACEHOLDER = /\{(\w+)\}/g;

function placeholders(value) {
  const found = new Set();
  let match;
  PLACEHOLDER.lastIndex = 0;
  while ((match = PLACEHOLDER.exec(value)) !== null) found.add(match[1]);
  return [...found].sort();
}

// ── Category 1: locale parity ───────────────────────────────────────────────

test('every English key exists in ar and zh (no missing keys)', () => {
  const enKeys = Object.keys(EN).sort();
  assert.deepEqual(Object.keys(AR).sort(), enKeys, 'ar key set must equal en');
  assert.deepEqual(Object.keys(ZH).sort(), enKeys, 'zh key set must equal en');
});

test('no locale defines extra keys beyond English', () => {
  const enKeys = new Set(Object.keys(EN));
  for (const [lang, locale] of Object.entries(LOCALES)) {
    const extra = Object.keys(locale).filter((key) => !enKeys.has(key));
    assert.deepEqual(extra, [], `${lang} defines keys absent from en`);
  }
});

test('no locale value is an empty string', () => {
  for (const [lang, locale] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(locale)) {
      assert.equal(typeof value, 'string', `${lang}.${key} must be a string`);
      assert.ok(value.length > 0, `${lang}.${key} is an empty string`);
    }
  }
});

test('the locale set is exactly en/ar/zh with 185 keys each', () => {
  assert.deepEqual(Object.keys(LOCALES).sort(), ['ar', 'en', 'zh']);
  assert.equal(Object.keys(EN).length, 185);
});

// ── Category 2: placeholder parity ──────────────────────────────────────────

test('every parameterised key uses the identical placeholder set in all locales', () => {
  const failures = [];
  for (const [key, enValue] of Object.entries(EN)) {
    const expected = placeholders(enValue);
    if (expected.length === 0) continue;
    for (const [lang, locale] of Object.entries(LOCALES)) {
      const actual = placeholders(locale[key]);
      if (actual.join(',') !== expected.join(',')) {
        failures.push(`${key} [${lang}]: expected {${expected.join(',')}} got {${actual.join(',')}}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test('the known parameterised keys are present and parameterised', () => {
  const expectedKeys = [
    'translation.failed',
    'history.daysAgo',
    'history.seconds',
    'history.minutes',
    'history.minutesSeconds',
    'settings.engine.download.flavor',
    'settings.engine.downloading',
    'settings.engine.suggested',
    'settings.engine.useFlavor',
    'settings.model.downloading',
  ];
  for (const key of expectedKeys) {
    assert.ok(placeholders(EN[key]).length > 0, `${key} must carry a placeholder`);
  }
});

// ── Category 3: fallback ────────────────────────────────────────────────────

test('t() returns the English string when the active locale lacks the key', () => {
  // Inject a deliberately partial Arabic locale (missing 'nav.settings') to
  // exercise the fallback chain: active locale -> en -> key.
  const partialAr = { ...AR };
  delete partialAr['nav.settings'];
  const arPath = path.resolve('src/i18n/locales/ar.ts');
  const i18n = loadTs('src/i18n/index.ts', (resolved) => (
    resolved === arPath ? { ar: partialAr } : undefined
  ));

  i18n.setLanguage('ar');
  assert.equal(i18n.t('nav.settings'), EN['nav.settings']);
  assert.notEqual(i18n.t('nav.settings'), 'nav.settings');
});

test('t() never renders a raw key for any key known to English', () => {
  const i18n = loadTs('src/i18n/index.ts');
  for (const language of ['en', 'ar', 'zh']) {
    i18n.setLanguage(language);
    for (const key of Object.keys(EN)) {
      const value = i18n.t(key);
      assert.notEqual(value, key, `${language}.${key} rendered the raw key`);
      assert.ok(value.length > 0, `${language}.${key} rendered empty`);
    }
  }
});

test('t() returns the key itself only for a key unknown to every locale', () => {
  // Last-resort behaviour: there is no English string to fall back to. This is
  // why the markup-key-existence test (i18n-markup.test.cjs) matters — it
  // guarantees no such key is ever referenced by the UI.
  const i18n = loadTs('src/i18n/index.ts');
  i18n.setLanguage('ar');
  assert.equal(i18n.t('this.key.does.not.exist'), 'this.key.does.not.exist');
});

// ── Supporting behaviour: interpolation and language guards ─────────────────

test('t() interpolates params and leaves unknown placeholders untouched', () => {
  const i18n = loadTs('src/i18n/index.ts');
  i18n.setLanguage('en');
  assert.equal(i18n.t('settings.engine.download.flavor', { flavor: 'CPU', size: '8 MB' }), 'Download CPU (~8 MB)');
  // A missing param must not silently vanish — the placeholder stays visible.
  assert.equal(i18n.t('settings.engine.downloading', {}), 'Downloading {flavor} engine');
});

test('placeholder values containing braces, dollars or newlines interpolate safely', () => {
  const i18n = loadTs('src/i18n/index.ts');
  i18n.setLanguage('en');
  // Replacement is done with a callback, so `$&` / `$1` in a value are literal.
  assert.equal(i18n.t('translation.failed', { error: '$& $1 {{}} \\' }), 'Translation failed: $& $1 {{}} \\');
  assert.equal(i18n.t('settings.engine.suggested', { gpu: 'AMD\nRadeon' }), 'Suggested for your PC: AMD\nRadeon');
});

test('normalizeUILanguage / isUILanguage accept only en/ar/zh', () => {
  const i18n = loadTs('src/i18n/index.ts');
  for (const good of ['en', 'ar', 'zh']) {
    assert.equal(i18n.isUILanguage(good), true);
    assert.equal(i18n.normalizeUILanguage(good), good);
  }
  for (const bad of ['', 'de', 'EN', 'ar-SA', 'auto', null, undefined, 42, {}]) {
    assert.equal(i18n.isUILanguage(bad), false);
    assert.equal(i18n.normalizeUILanguage(bad), 'en');
  }
});

test('applyLanguage sets html lang/dir and isRTL only reports Arabic', () => {
  const i18n = loadTs('src/i18n/index.ts');
  const root = { lang: '', dir: '' };
  const previous = global.document;
  global.document = { documentElement: root };
  try {
    i18n.applyLanguage('ar');
    assert.equal(root.lang, 'ar');
    assert.equal(root.dir, 'rtl');
    i18n.applyLanguage('zh');
    assert.equal(root.lang, 'zh');
    assert.equal(root.dir, 'ltr');
    assert.equal(i18n.isRTL('zh'), false);
    assert.equal(i18n.isRTL('ar'), true);
  } finally {
    if (previous === undefined) delete global.document;
    else global.document = previous;
  }
});
