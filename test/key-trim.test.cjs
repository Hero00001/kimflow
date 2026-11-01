'use strict';
// Key-value trimming on the secret-save path.
//
// Keys pasted from an email or a website often carry a trailing newline or
// surrounding spaces. A stored "key\n" is rejected by the provider in a way
// that looks exactly like "no key saved", so the save path must trim before
// anything reaches durable storage.

const test = require('node:test');
const assert = require('node:assert/strict');
const { migratePlaintextKeys, getSecret, hasSecret, describeSecret, deleteSecret } = require('../backend/secrets.cjs');

test('migratePlaintextKeys trims padded keys before storing', () => {
  const { settings } = migratePlaintextKeys({ deepgramApiKey: '  dk-key-123 \n\t' });
  assert.equal(settings.deepgramApiKey, '', 'plaintext is stripped from settings');
  assert.equal(getSecret('deepgramApiKey'), 'dk-key-123', 'stored value is trimmed');
});

test('migratePlaintextKeys trims every secret name', () => {
  const { settings } = migratePlaintextKeys({
    deepgramApiKey: 'dk\n',
    speechmaticsApiKey: '\nsm',
    geminiApiKey: ' gm ',
  });
  assert.equal(settings.deepgramApiKey, '');
  assert.equal(settings.speechmaticsApiKey, '');
  assert.equal(settings.geminiApiKey, '');
  assert.equal(getSecret('deepgramApiKey'), 'dk');
  assert.equal(getSecret('speechmaticsApiKey'), 'sm');
  assert.equal(getSecret('geminiApiKey'), 'gm');
});

test('whitespace-only key material is dropped, not stored', () => {
  // Earlier tests in this file stored a real key for this name; clear the
  // module's in-memory state first so this test starts from a clean slate.
  deleteSecret('deepgramApiKey');
  const before = describeSecret('deepgramApiKey');
  const { settings } = migratePlaintextKeys({ deepgramApiKey: '   \n  ' });
  assert.equal(settings.deepgramApiKey, '');
  assert.equal(getSecret('deepgramApiKey'), '');
  assert.notEqual(describeSecret('deepgramApiKey'), 'saved');
  // Under plain node (no safeStorage) the state stays 'missing' throughout;
  // the point is that whitespace never becomes a stored secret.
  assert.ok(['missing', 'volatile', before].includes(describeSecret('deepgramApiKey')));
  assert.equal(hasSecret('deepgramApiKey'), before === 'volatile');
});
