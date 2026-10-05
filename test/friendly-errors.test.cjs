const test = require('node:test');
const assert = require('node:assert');
const { friendlyMessageFor } = require('../backend/friendly-errors.cjs');
test('maps mic NotAllowedError to friendly text', () => {
  const err = new Error('Permission denied');
  err.name = 'NotAllowedError';
  assert.equal(friendlyMessageFor(err), 'Microphone blocked — allow access in system settings, then try again.');
});
test('maps ENOENT binary to friendly text', () => {
  const err = new Error('spawn C:\\bin\\whisper-cli.exe ENOENT');
  err.code = 'ENOENT';
  assert.equal(friendlyMessageFor(err), 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.');
});
test('returns null for unknown', () => {
  assert.equal(friendlyMessageFor(new Error('weird xyz 123')), null);
});
