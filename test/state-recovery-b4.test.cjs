'use strict';
// test/state-recovery-b4.test.cjs
//
// Fail-first tests for B4 (recording state & renderer recovery):
//   - A2:  a dead main renderer is reloaded (bounded); the pending floating
//          action queue is bounded and dropped on crash.
//   - #14: the end button stays reachable during TRANSCRIBING (cancel).
//   - #11: a push-to-talk pointerleave must NOT stop a hotkey-started session.
//   - #12: a devicechange that does not remove the active mic must NOT pause.
//   - #13: resuming on a dead stream fails loudly instead of recording silence.
//
// Not covered here (noted in the ticket): #09's persistChain .catch — persist()
// is module-private and reachable only through the full settings form; #24's
// DOM-authoritative microphone reads the real DOM element, which the stub
// resolves to null by design (fallback keeps tests green, app uses the DOM).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

// ── A2: main-renderer crash recovery + bounded/expiring queues ──────────────

test('a crashed main renderer is reloaded, bounded, and stale actions are dropped', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b4-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });

  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const main = harness.instances[0];
  const event = { sender: { id: main.webContents.id } };

  // The action queue is bounded: 30 queued actions replay at most 20.
  const overlayAction = harness.handlers.get('overlay-action');
  for (let i = 0; i < 30; i += 1) await overlayAction(event, 'stop');
  main.webContents.listeners.get('did-finish-load')();
  const replays = main.webContents.sent.filter((m) => m.channel === 'overlay-action');
  assert.ok(replays.length <= 20, `a stale burst must be bounded, got ${replays.length}`);

  // A crash drops the queue entirely and reloads the renderer.
  main.webContents.sent.length = 0;
  const gone = main.webContents.listeners.get('render-process-gone');
  assert.equal(typeof gone, 'function', 'render-process-gone is wired');
  gone({}, { reason: 'renderer-crash' });
  assert.equal(main.webContents.reloadCalls, 1, 'the dead renderer is reloaded');
  assert.equal(main.webContents.sent.filter((m) => m.channel === 'overlay-action').length, 0,
    'actions queued before the crash are not replayed');

  // The reload is bounded: a crash loop cannot spin the renderer forever.
  for (let i = 0; i < 5; i += 1) gone({}, { reason: 'renderer-crash' }); // crashes 2..6
  assert.equal(main.webContents.reloadCalls, 5, 'reloads are capped at five per window');
});

// ── #14: cancel stays reachable during transcription ────────────────────────

test('the end button is enabled in every state, including TRANSCRIBING', (t) => {
  const dom = createDom({});
  const status = loadTs('src/status.ts', (resolved) => {
    if (resolved === path.resolve('src/dom.ts')) return dom.exports();
    return undefined;
  }, new Map());
  status.setState(status.STATES.TRANSCRIBING);
  assert.equal(dom.byId('end-btn').disabled, false, 'cancel must be reachable during transcription');
  assert.equal(dom.byId('record-btn').disabled, true, 'record stays disabled during transcription');
  status.setState(status.STATES.RECORDING);
  assert.equal(dom.byId('end-btn').disabled, false);
  assert.equal(dom.byId('stop-btn').disabled, false);
});

// ── #11: pointerleave ownership ─────────────────────────────────────────────

function loadRecordingModule(t, apiCalls, settings) {
  const dom = createDom({});
  const cache = new Map();
  const domPath = path.resolve('src/dom.ts');
  const storePath = path.resolve('src/store.ts');
  const statusPath = path.resolve('src/status.ts');
  const recorderPath = path.resolve('src/audio/recorder.ts');
  const translationPath = path.resolve('src/translation.ts');
  const utilsPath = path.resolve('src/utils.ts');
  const i18nPath = path.resolve('src/i18n/index.ts');

  const store = { getSettings: () => settings, setSettings: () => {} };
  const status = loadTs('src/status.ts', (resolved) => (resolved === domPath ? dom.exports() : undefined), cache);
  cache.set(statusPath, { id: statusPath, filename: statusPath, loaded: true, exports: status });
  cache.set(storePath, { id: storePath, filename: storePath, loaded: true, exports: store });
  cache.set(recorderPath, {
    id: recorderPath, filename: recorderPath, loaded: true,
    exports: {
      abortCapture: () => {},
      captureState: () => undefined,
      pauseCapture: () => {},
      resumeCapture: () => {},
      startCapture: async () => {},
      stopCapture: async () => { throw new Error('Audio recording is not active'); },
      watchMicDeviceChanges: () => () => {},
    },
  });
  cache.set(translationPath, {
    id: translationPath, filename: translationPath, loaded: true,
    exports: { clearTranslation: () => {}, showTranslating: () => {}, showTranslation: () => {} },
  });
  cache.set(utilsPath, {
    id: utilsPath, filename: utilsPath, loaded: true,
    exports: { errorDetails: () => '', friendlyError: () => 'error' },
  });
  const i18n = loadTs('src/i18n/index.ts', undefined, cache);
  cache.set(i18nPath, { id: i18nPath, filename: i18nPath, loaded: true, exports: i18n });

  const previousWindow = globalThis.window;
  globalThis.window = {
    api: apiCalls,
    addEventListener: () => {},
    setTimeout,
    clearTimeout,
  };
  t.after(() => { globalThis.window = previousWindow; });

  const recording = loadTs('src/recording.ts', (resolved) => {
    if (resolved === domPath) return dom.exports();
    return undefined;
  }, cache);
  return { recording, status, dom };
}

test('a push-to-talk pointerleave does NOT stop a hotkey-started session (#11)', async (t) => {
  const apiCalls = {
    cancelRecording: async () => { apiCalls.cancelCount = (apiCalls.cancelCount || 0) + 1; },
    startRecording: async () => {},
    onRecordingState: () => () => {},
    onTranscriptionResult: () => () => {},
    onRecordingTimeLimit: () => () => {},
    onHistoryUpdated: () => () => {},
    onDownloadProgress: () => () => {},
  };
  const settings = { recordingMode: 'push-to-talk', microphone: 'default', engine: 'local' };
  const { recording, status, dom } = loadRecordingModule(t, apiCalls, settings);
  recording.wireRecordingControls();

  // A session started by the HOTKEY: no pointerdown ever happened.
  status.setState(status.STATES.RECORDING);
  dom.byId('record-btn').emit('pointerleave');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(!apiCalls.cancelCount, 'a mouse passing over the button must not stop a hotkey session');

  // A BUTTON-started session: pointerdown owns it, so leaving releases it.
  status.setState(status.STATES.READY);
  dom.byId('record-btn').emit('pointerdown', { preventDefault: () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  dom.byId('record-btn').emit('pointerleave');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(apiCalls.cancelCount >= 1, 'leaving the button releases a button-owned session');
});

// ── #12 / #13: microphone device handling ───────────────────────────────────

function loadAudioRecorder(t, options) {
  const { devices } = options;
  const dom = createDom({});
  const cache = new Map();
  const domPath = path.resolve('src/dom.ts');

  const listeners = new Set();
  const fakeTrack = { readyState: 'live', stop: () => {}, getSettings: () => ({ deviceId: 'dev-1' }) };
  const fakeStream = {
    getTracks: () => [fakeTrack],
    getAudioTracks: () => [fakeTrack],
  };
  class FakeMediaRecorder {
    constructor() { this.state = 'recording'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
  }
  FakeMediaRecorder.isTypeSupported = () => false;
  const previous = {
    navigatorDesc: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    MediaRecorder: globalThis.MediaRecorder,
    AudioContext: globalThis.AudioContext,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => fakeStream,
        enumerateDevices: async () => devices(),
        addEventListener: (event, handler) => listeners.add(handler),
        removeEventListener: (event, handler) => listeners.delete(handler),
      },
    },
  });
  globalThis.MediaRecorder = FakeMediaRecorder;
  globalThis.AudioContext = class {
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData() {} }; }
    close() { return Promise.resolve(); }
  };
  globalThis.window = {};
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  t.after(() => {
    if (previous.navigatorDesc) Object.defineProperty(globalThis, 'navigator', previous.navigatorDesc);
    globalThis.MediaRecorder = previous.MediaRecorder;
    globalThis.AudioContext = previous.AudioContext;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
  });

  const recorder = loadTs('src/audio/recorder.ts', (resolved) => {
    if (resolved === domPath) return dom.exports();
    if (resolved === path.resolve('src/store.ts')) return { getSettings: () => ({ useFlowBarWidget: false }) };
    if (resolved === path.resolve('src/status.ts')) return { showError: () => {} };
    if (resolved === path.resolve('src/utils.ts')) return { errorDetails: () => '', friendlyError: () => '' };
    if (resolved === path.resolve('src/i18n/index.ts')) return { t: (key) => key };
    if (resolved === path.resolve('src/audio/level.ts')) return { micLevelFromRms: () => 0 };
    return undefined;
  }, cache);
  return { recorder, listeners, fakeTrack };
}

test('a device ADDITION does not pause an active recording (#12)', async (t) => {
  let currentDevices = [{ kind: 'audioinput', deviceId: 'dev-1', label: 'Mic 1' }];
  const { recorder, listeners } = loadAudioRecorder(t, { devices: () => currentDevices });
  await recorder.startCapture('dev-1');
  recorder.watchMicDeviceChanges();
  const handler = [...listeners][0];
  assert.equal(typeof handler, 'function', 'devicechange is wired');

  // A headphone is plugged in: the input list GROWS.
  currentDevices = [
    { kind: 'audioinput', deviceId: 'dev-1', label: 'Mic 1' },
    { kind: 'audioinput', deviceId: 'dev-2', label: 'Mic 2' },
  ];
  handler();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.captureState(), 'recording', 'a device addition must not pause the dictation');
});

test('removing the active microphone still pauses, and resuming a dead stream fails loudly (#12, #13)', async (t) => {
  let currentDevices = [{ kind: 'audioinput', deviceId: 'dev-1', label: 'Mic 1' }];
  const { recorder, listeners, fakeTrack } = loadAudioRecorder(t, { devices: () => currentDevices });
  await recorder.startCapture('dev-1');
  recorder.watchMicDeviceChanges();
  const handler = [...listeners][0];

  currentDevices = [{ kind: 'audioinput', deviceId: 'dev-2', label: 'Mic 2' }];
  handler();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(recorder.captureState(), 'paused', 'a real unplug still pauses');

  // Resuming on the dead stream must fail loudly, not record silence (#13).
  fakeTrack.readyState = 'ended';
  assert.throws(() => recorder.resumeCapture(), /disconnected/i);
});
