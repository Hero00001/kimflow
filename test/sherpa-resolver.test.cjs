// test/sherpa-resolver.test.cjs
//
// SenseVoice routing (sensevoice spec §Locked decisions): ONLY zh/yue/ja/ko
// dictation reaches the sherpa-onnx sidecar, ONLY when localEngine is
// 'sherpa-onnx' AND the sidecar + model are present. Everything else —
// English, Arabic, auto, unknown junk — falls back to whisper.cpp so those
// languages can never regress. The deps are injected so the matrix does not
// touch the real filesystem.
const test = require('node:test');
const assert = require('node:assert');

const sherpa = require('../backend/engines/sherpa.cjs');
const transcribe = require('../backend/transcribe.cjs');

const ROUTED = { model: 'sense-voice-int8', engine: 'sherpa-onnx' };
const FALLBACK = { fallback: 'whisper-cpp' };

function resolve(language, { localEngine = 'sherpa-onnx', downloaded = true, sidecar = true } = {}) {
  return sherpa.resolveSherpaModel(language, 'sense-voice-int8', {
    localEngine,
    modelDownloaded: downloaded,
    sidecarPresent: sidecar,
  });
}

// ── Routing matrix: language × localEngine × downloaded ─────────────────────

test('zh/yue/ja/ko route to sense-voice when everything is ready', () => {
  for (const language of ['zh', 'yue', 'ja', 'ko']) {
    assert.deepEqual(resolve(language), ROUTED, `${language} must route to sense-voice`);
  }
});

test('en/ar/auto and unknown junk NEVER route to sense-voice (fallback to whisper)', () => {
  for (const language of ['en', 'ar', 'auto', 'de', 'es', 'klingon', '', '  ', 'ZH-upper', null, undefined, 42]) {
    assert.deepEqual(resolve(language), FALLBACK, `${String(language)} must fall back to whisper`);
  }
});

test('localEngine whisper-cpp never routes to sense-voice, even for zh', () => {
  for (const language of ['zh', 'yue', 'ja', 'ko', 'en', 'auto']) {
    assert.deepEqual(resolve(language, { localEngine: 'whisper-cpp' }), FALLBACK);
  }
});

test('an undownloaded model falls back for every language', () => {
  for (const language of ['zh', 'yue', 'ja', 'ko']) {
    assert.deepEqual(resolve(language, { downloaded: false }), FALLBACK);
  }
});

test('a missing sidecar falls back for every language (even with the model downloaded)', () => {
  for (const language of ['zh', 'yue', 'ja', 'ko']) {
    assert.deepEqual(resolve(language, { sidecar: false }), FALLBACK);
  }
});

test('both missing falls back, and the matrix is fully covered', () => {
  const languages = ['zh', 'yue', 'ja', 'ko', 'en', 'ar', 'auto', 'klingon'];
  for (const language of languages) {
    for (const localEngine of ['whisper-cpp', 'sherpa-onnx']) {
      for (const downloaded of [true, false]) {
        for (const sidecar of [true, false]) {
          const result = resolve(language, { localEngine, downloaded, sidecar });
          const shouldRoute = localEngine === 'sherpa-onnx'
            && ['zh', 'yue', 'ja', 'ko'].includes(language)
            && downloaded && sidecar;
          assert.deepEqual(result, shouldRoute ? ROUTED : FALLBACK,
            `${language} x ${localEngine} x downloaded=${downloaded} x sidecar=${sidecar}`);
        }
      }
    }
  }
});

test('an unknown stored sherpaModel resolves to the registry entry (coercion at use time)', () => {
  assert.deepEqual(
    sherpa.resolveSherpaModel('zh', 'not-a-model', { localEngine: 'sherpa-onnx', modelDownloaded: true, sidecarPresent: true }),
    ROUTED,
  );
});

// ── Dispatcher contract (backend/transcribe.cjs) ────────────────────────────

test('the dispatcher exposes the sherpa engine under stable names', () => {
  assert.equal(typeof transcribe.transcribeSherpa, 'function');
  assert.equal(typeof transcribe.resolveSherpaModel, 'function');
  assert.deepEqual(
    transcribe.resolveSherpaModel('zh', 'sense-voice-int8', { localEngine: 'sherpa-onnx', modelDownloaded: true, sidecarPresent: true }),
    ROUTED,
  );
});

// ── Output parsing ──────────────────────────────────────────────────────────

test('parseSherpaOutput handles the JSON line and bare-text fallbacks', () => {
  assert.equal(sherpa.parseSherpaOutput('{"lang":"zh","text":"大家好"}'), '大家好');
  assert.equal(sherpa.parseSherpaOutput('{"text":"quoted \\"inner\\" kept"}'), 'quoted "inner" kept');
  assert.equal(sherpa.parseSherpaOutput('plain text output'), 'plain text output');
  assert.equal(sherpa.parseSherpaOutput(''), '');
  assert.equal(sherpa.parseSherpaOutput(undefined), '');
});
