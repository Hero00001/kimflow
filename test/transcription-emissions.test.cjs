// test/transcription-emissions.test.cjs
//
// Guards two recorder behaviors:
//  1. The auto-stop time-limit emission must never throw, even when
//     a target window's webContents is gone (mirrors sendToWindow).
//  2. A translated stop emits exactly one "translating" interim
//     update; the final result is returned to the caller (the IPC
//     layer owns the single final broadcast).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function useIsolatedRecorder(t, transcribeImpl, translateImpl) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-emit-'));
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
    '../backend/translation.service.cjs': {
      warmup: () => {},
      polish: async () => null,
      translate: translateImpl,
    },
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

test('time-limit emission survives a dead webContents', async (t) => {
  let sendCalled = false;
  const deadContentsWindow = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      send: () => { sendCalled = true; throw new Error('Object has been destroyed'); },
    },
  };
  const recorder = useIsolatedRecorder(t, async () => ({ text: 'hi' }), async () => null);
  await recorder.startRecording(SETTINGS, [deadContentsWindow]);
  recorder.scheduleAutoStopTimer([deadContentsWindow], 20);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(sendCalled, false);
  assert.equal(recorder.getState(), 'recording');
  recorder.clearAutoStopTimer();
  await recorder.cancelRecording([]);
});

test('translated stop emits one interim update and returns the final result', async (t) => {
  const emissions = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => { if (channel === 'transcription-result') emissions.push(payload); } },
  };
  const recorder = useIsolatedRecorder(t, async () => ({ text: 'hello world' }), async () => 'bonjour');
  const settings = { ...SETTINGS, translationEnabled: true, translationTarget: 'en' };
  await recorder.startRecording(settings, [fakeWindow]);
  const result = await recorder.stopRecording(settings, [fakeWindow], new ArrayBuffer(8));
  const interim = emissions.filter((e) => e.translating === true);
  assert.equal(interim.length, 1);
  assert.equal(interim[0].text, 'Hello world.');
  assert.equal(result.translation, 'bonjour');
  assert.equal(result.translating, false);
  await recorder.cancelRecording([]);
});
