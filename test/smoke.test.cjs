// test/smoke.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_SETTINGS, normalizeSettings } = require('../backend/settings.cjs');
test('defaults preserve local engine + auto language', () => {
  const s = normalizeSettings({});
  assert.equal(s.engine, DEFAULT_SETTINGS.engine);
  assert.equal(s.inputLanguage, 'auto');
});
