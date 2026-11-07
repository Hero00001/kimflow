'use strict';
// test/key-trim.test.cjs
//
// Key-value trimming on the secret-save path.
//
// Keys pasted from an email or a website often carry a trailing newline or
// surrounding spaces. A stored "key\n" is rejected by the provider in a way
// that looks exactly like "no key saved", so the save path must trim before
// anything reaches durable storage.
//
// Each test gets a fresh, isolated settings/secrets module graph, so there is
// no shared in-memory fallback and no dependence on test order.

const test = require('node:test');
const assert = require('node:assert/strict');
const { useIsolatedConfig } = require('./helpers/isolated-config.cjs');

test('migratePlaintextKeys trims padded keys before storing', (t) => {
  const { secrets } = useIsolatedConfig(t);
  const { settings } = secrets.migratePlaintextKeys({ deepgramApiKey: '  dk-key-123 \n\t' });
  assert.equal(settings.deepgramApiKey, '', 'plaintext is stripped from settings');
  assert.equal(secrets.getSecret('deepgramApiKey'), 'dk-key-123', 'stored value is trimmed');
});

test('migratePlaintextKeys trims every secret name', (t) => {
  const { secrets } = useIsolatedConfig(t);
  const { settings } = secrets.migratePlaintextKeys({
    deepgramApiKey: 'dk\n',
    speechmaticsApiKey: '\nsm',
    geminiApiKey: ' gm ',
  });
  assert.equal(settings.deepgramApiKey, '');
  assert.equal(settings.speechmaticsApiKey, '');
  assert.equal(settings.geminiApiKey, '');
  assert.equal(secrets.getSecret('deepgramApiKey'), 'dk');
  assert.equal(secrets.getSecret('speechmaticsApiKey'), 'sm');
  assert.equal(secrets.getSecret('geminiApiKey'), 'gm');
});

test('whitespace-only key material is dropped, not stored', (t) => {
  const { secrets } = useIsolatedConfig(t);
  // A fresh module instance and an empty temp secret directory: whitespace
  // never becomes a stored secret, regardless of which tests ran before.
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'missing', 'the isolated store starts empty');
  const { settings } = secrets.migratePlaintextKeys({ deepgramApiKey: '   \n  ' });
  assert.equal(settings.deepgramApiKey, '');
  assert.equal(secrets.getSecret('deepgramApiKey'), '');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'missing');
  assert.equal(secrets.hasSecret('deepgramApiKey'), false);
});
