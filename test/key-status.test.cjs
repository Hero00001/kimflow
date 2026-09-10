const test = require('node:test');
const assert = require('node:assert');
const secrets = require('../backend/secrets.cjs');

test('reports whether a key is stored without revealing it', () => {
  assert.equal(typeof secrets.hasSecret, 'function');
  assert.equal(typeof secrets.deleteSecret, 'function');
  secrets.deleteSecret('deepgramApiKey');
  assert.equal(secrets.hasSecret('deepgramApiKey'), false);
  secrets.setSecret('deepgramApiKey', 'key-abc');
  assert.equal(secrets.hasSecret('deepgramApiKey'), true);
  secrets.deleteSecret('deepgramApiKey');
  assert.equal(secrets.hasSecret('deepgramApiKey'), false);
});
