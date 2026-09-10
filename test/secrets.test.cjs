// test/secrets.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { migratePlaintextKeys } = require('../backend/secrets.cjs');
test('migrates plaintext keys out of settings object', () => {
  const out = migratePlaintextKeys({ deepgramApiKey: 'key-abc', geminiApiKey: 'AIza-x', engine: 'local' });
  assert.equal(out.settings.deepgramApiKey, '');
  assert.equal(out.settings.geminiApiKey, '');
  assert.equal(out.migrated, true);
});
