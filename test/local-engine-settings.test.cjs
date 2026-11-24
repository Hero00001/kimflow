// test/local-engine-settings.test.cjs
//
// The two new SenseVoice settings keys (sensevoice ticket 04) round-trip
// through normalizeSettings exactly like every other whitelisted key:
// absent = default (whisper.cpp, today's behavior), unknown values coerce.
const test = require('node:test');
const assert = require('node:assert');
const { DEFAULT_SETTINGS, normalizeSettings } = require('../backend/settings.cjs');

test('defaults are whisper-cpp + sense-voice-int8 (no behavior change for existing configs)', () => {
  assert.equal(DEFAULT_SETTINGS.localEngine, 'whisper-cpp');
  assert.equal(DEFAULT_SETTINGS.sherpaModel, 'sense-voice-int8');
  assert.equal(normalizeSettings({}).localEngine, 'whisper-cpp');
  assert.equal(normalizeSettings({}).sherpaModel, 'sense-voice-int8');
  assert.equal(normalizeSettings(null).localEngine, 'whisper-cpp');
});

test('normalizeSettings accepts the whitelisted localEngine values', () => {
  for (const good of ['whisper-cpp', 'sherpa-onnx']) {
    assert.equal(normalizeSettings({ localEngine: good }).localEngine, good);
  }
});

test('normalizeSettings coerces unknown localEngine values to whisper-cpp', () => {
  for (const bad of ['sherpa', 'whisper', 'deepgram', 'WHISPER-CPP', 'sherpa-onnx ', '', 42, true, null, undefined, [], {}]) {
    assert.equal(normalizeSettings({ localEngine: bad }).localEngine, 'whisper-cpp',
      `localEngine ${JSON.stringify(bad)} must coerce to the default`);
  }
});

test('normalizeSettings accepts the registry id for sherpaModel and coerces the rest', () => {
  assert.equal(normalizeSettings({ sherpaModel: 'sense-voice-int8' }).sherpaModel, 'sense-voice-int8');
  for (const bad of ['nova-3', 'small', 'SenseVoice', '', 42, null, undefined, [], {}]) {
    assert.equal(normalizeSettings({ sherpaModel: bad }).sherpaModel, 'sense-voice-int8',
      `sherpaModel ${JSON.stringify(bad)} must coerce to the default`);
  }
});

test('localEngine and sherpaModel never affect any other setting', () => {
  const base = normalizeSettings({ engine: 'local', whisperModel: 'small' });
  const withSherpa = normalizeSettings({ engine: 'local', whisperModel: 'small', localEngine: 'sherpa-onnx', sherpaModel: 'sense-voice-int8' });
  for (const key of Object.keys(base)) {
    if (key === 'localEngine' || key === 'sherpaModel') continue;
    assert.deepEqual(withSherpa[key], base[key], `${key} must be untouched by the sherpa keys`);
  }
});
