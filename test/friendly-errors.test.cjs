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
  assert.equal(friendlyMessageFor(err), 'Whisper binary not found — use Select binary in Settings to locate whisper-cli.');
});
// The exact error strings backend/engines/sherpa.cjs throws. Both used to be
// captured by generic rules: "model not found" by the Whisper rule, and
// "sherpa-onnx-offline" (binary name contains "offline") by the network rule.
test('maps the SenseVoice model-not-found error to the SenseVoice message (not the Whisper one)', () => {
  const err = new Error('SenseVoice model not found — download it in Settings first.');
  assert.equal(friendlyMessageFor(err), 'SenseVoice model not found — download it in Settings first.');
});
test('maps the SenseVoice sidecar-not-found error to the SenseVoice runtime message (not the network one)', () => {
  const err = new Error('SenseVoice sidecar not found — sherpa-onnx-offline is not installed.');
  assert.equal(friendlyMessageFor(err), 'SenseVoice runtime not found — download it in Settings first.');
});
test('returns null for unknown', () => {
  assert.equal(friendlyMessageFor(new Error('weird xyz 123')), null);
});
