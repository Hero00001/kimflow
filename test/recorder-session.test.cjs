// test/recorder-session.test.cjs
//
// A slow stopRecording must not clobber a newer live session when it settles:
// stop -> cancel -> start again -> first stop resolves => state stays RECORDING.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function useIsolatedRecorder(t, transcribeImpl) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-session-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;

  class FakeAudioRecorder {
    async start() {}
    async stop() {}
    onChunk() {}
    async saveWav(dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, Buffer.from('RIFF-FAKE')); }
  }
  const transcribeStub = {
    transcribeLocal: (...args) => transcribeStub._impl(...args),
    transcribeDeepgram: (...args) => transcribeStub._impl(...args),
    transcribeSpeechmatics: (...args) => transcribeStub._impl(...args),
    _impl: transcribeImpl,
  };
  const seeds = {
    '../backend/audio.cjs': { AudioRecorder: FakeAudioRecorder },
    '../backend/transcribe.cjs': transcribeStub,
    '../backend/paste.cjs': { pasteText: () => ({ ok: true }) },
    '../backend/translation.service.cjs': { warmup: () => {}, polish: async () => null, translate: async () => null },
  };
  const evict = [
    '../backend/audio.cjs',
    '../backend/transcribe.cjs',
    '../backend/paste.cjs',
    '../backend/translation.service.cjs',
    '../backend/settings.cjs',
    '../backend/secrets.cjs',
    '../backend/history.cjs',
    '../backend/recorder.cjs',
  ].map((m) => require.resolve(m));
  const saved = new Map();
  for (const resolved of evict) {
    if (require.cache[resolved]) {
      saved.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    }
  }
  for (const [spec, exportsObj] of Object.entries(seeds)) {
    const resolved = require.resolve(spec);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
  }
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;

  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    for (const resolved of evict) delete require.cache[resolved];
    for (const [resolved, entry] of saved) require.cache[resolved] = entry;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  return require('../backend/recorder.cjs');
}

const SETTINGS = {
  inputLanguage: 'auto',
  translationEnabled: false,
  aiPolish: false,
  engine: 'local',
  whisperModel: 'small',
  whisperBinaryPath: '',
  polishMode: 'thorough',
  customVocabulary: [],
};

test('stale stop does not reset a newer live session', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const recorder = useIsolatedRecorder(t, () => gate);

  await recorder.startRecording(SETTINGS, []);
  assert.equal(recorder.getState(), 'recording');
  const firstStop = recorder.stopRecording(SETTINGS, [], new ArrayBuffer(8));
  assert.equal(recorder.getState(), 'transcribing');

  await recorder.cancelRecording([]);
  await recorder.startRecording(SETTINGS, []);
  assert.equal(recorder.getState(), 'recording');

  release({ text: 'hello world' });
  const result = await firstStop;
  assert.deepEqual(result, { text: '', aborted: true });
  assert.equal(recorder.getState(), 'recording');

  await recorder.cancelRecording([]);
  assert.equal(recorder.getState(), 'ready');
});

test('normal stop still returns to ready', async (t) => {
  const recorder = useIsolatedRecorder(t, async () => ({ text: 'hello world' }));
  await recorder.startRecording(SETTINGS, []);
  const result = await recorder.stopRecording(SETTINGS, [], new ArrayBuffer(8));
  assert.equal(result && result.text, 'Hello world.');
  assert.equal(recorder.getState(), 'ready');
  await recorder.cancelRecording([]);
});
