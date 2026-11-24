'use strict';
// Ticket 07: translation-parity test.
//
// Mirrors Hex's test-enforced translation parity: every UI string known to
// English (`en`) must exist in `ar` and `zh`, and no locale may invent keys
// the English source of truth does not define. The runtime fallback chain
// (active locale -> en -> raw key) makes a missing `ar`/`zh` key silently
// render English to an Arabic/Chinese user — this test makes that a loud
// failure instead.
//
// The locale files are TypeScript; `test/helpers/ts-loader.cjs` transpiles
// them in-memory so plain `node --test` can exercise the real data (same
// pattern as `i18n-locales.test.cjs`).
//
// Unlike the deepEqual-based parity check in `i18n-locales.test.cjs`, the
// assertions here enumerate every offending key in the failure message, so a
// translator sees the exact list of strings to add rather than a raw diff.

const test = require('node:test');
const assert = require('node:assert');

const { loadTs } = require('./helpers/ts-loader.cjs');

const EN = loadTs('src/i18n/locales/en.ts').en;
const AR = loadTs('src/i18n/locales/ar.ts').ar;
const ZH = loadTs('src/i18n/locales/zh.ts').zh;

const LOCALES = { ar: AR, zh: ZH };

test('every English key exists in ar and zh (missing keys are listed)', () => {
  const missing = [];
  for (const key of Object.keys(EN)) {
    for (const [lang, locale] of Object.entries(LOCALES)) {
      if (!Object.prototype.hasOwnProperty.call(locale, key)) missing.push(`${lang}: ${key}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `keys present in en but missing from other locales: ${missing.join(', ') || '(none)'}`
  );
});

test('no locale defines extra keys beyond English (extras are listed)', () => {
  const extra = [];
  for (const [lang, locale] of Object.entries(LOCALES)) {
    for (const key of Object.keys(locale)) {
      if (!Object.prototype.hasOwnProperty.call(EN, key)) extra.push(`${lang}: ${key}`);
    }
  }
  assert.deepEqual(
    extra,
    [],
    `keys absent from en (stale or mistyped): ${extra.join(', ') || '(none)'}`
  );
});

test('every locale value is a non-empty string', () => {
  const bad = [];
  for (const [lang, locale] of Object.entries(LOCALES)) {
    for (const [key, value] of Object.entries(locale)) {
      if (typeof value !== 'string' || value.length === 0) bad.push(`${lang}: ${key}`);
    }
  }
  assert.deepEqual(
    bad,
    [],
    `locale values that are empty or not strings: ${bad.join(', ') || '(none)'}`
  );
});
