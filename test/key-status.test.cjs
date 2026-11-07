// test/key-status.test.cjs
//
// `deleteSecret` removes a file from the secret store. Under a bare node test
// runner that defaults to the REAL `~/.kimflow` directory, so every call here
// is pointed at a throwaway directory first.
const test = require('node:test');
const assert = require('node:assert');
const { useIsolatedConfig } = require('./helpers/isolated-config.cjs');

test('reports whether a key is stored without revealing it', (t) => {
  const { secrets } = useIsolatedConfig(t);
  assert.equal(typeof secrets.hasSecret, 'function');
  assert.equal(typeof secrets.deleteSecret, 'function');
  secrets.deleteSecret('deepgramApiKey');
  assert.equal(secrets.hasSecret('deepgramApiKey'), false);
  secrets.setSecret('deepgramApiKey', 'key-abc');
  assert.equal(secrets.hasSecret('deepgramApiKey'), true);
  secrets.deleteSecret('deepgramApiKey');
  assert.equal(secrets.hasSecret('deepgramApiKey'), false);
});
