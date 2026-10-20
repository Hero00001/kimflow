// test/settings-state-ownership.test.cjs
//
// Regression test for the HIGH defect: six settings silently reverted.
//
// `engine`, `recordingMode`, `polishMode`, `translationEnabled`, `aiPolish`
// and `whisperBinaryPath` have no form control, so their value lived only as
// an in-place mutation of the shared settings object. Every save response
// REPLACES that object with the server's snapshot — and the snapshot is
// serialised at send time, so it carries the value from BEFORE the user's
// next click. The mutation is discarded and the queued persist re-saves the
// old value.
//
//   1. user drags the accent colour -> save #1 goes out with engine "local"
//   2. user clicks "Deepgram" -> the handler mutates the shared object
//   3. save #1's response arrives and replaces the shared object with the
//      "local" snapshot -> the "deepgram" mutation is gone
//   4. the queued persist reads the shared object and saves "local"
//
// The UI still shows "Deepgram" highlighted, so the app disagrees with itself
// and with the disk.
//
// The fix: the settings form owns the values the user is editing. The
// settings with a control are read from the DOM (as they always were); the
// rest are read from the UI too — the active toggle button and the selected
// binary path — so a server snapshot can never undo a newer local choice.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

const BASE_SETTINGS = {
  microphone: 'default',
  engine: 'local',
  whisperModel: 'small',
  whisperRuntime: 'whisper-cpp',
  whisperBinaryPath: '',
  deepgramApiKey: '',
  deepgramModel: 'nova-3',
  speechmaticsApiKey: '',
  recordingMode: 'toggle',
  polishMode: 'thorough',
  customVocabulary: [],
  aiPolish: false,
  hotkey: 'CmdOrCtrl+Shift+Space',
  accentColor: '#8b5cf6',
  translationEnabled: false,
  translationProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: '',
  inputLanguage: 'auto',
  translationTarget: 'en',
  uiLanguage: 'en',
};

/**
 * Load src/settings-form.ts against a fake DOM and a controllable store.
 *
 * Only `./store` is stubbed; every other module (dom, status, utils, i18n,
 * translation, history, theme) is the real one, so the test exercises the
 * production settings code rather than a re-implementation.
 */
function loadForm(dom, store, api) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  globalThis.document = dom.document;
  globalThis.window = { api };
  if (!previousNavigator) globalThis.navigator = { platform: 'Linux x86_64', userAgent: 'node' };
  const storePath = path.resolve('src/store.ts');
  const cache = new Map();
  const form = loadTs('src/settings-form.ts', (resolved) => (
    resolved === storePath ? store : undefined
  ), cache);
  return {
    form,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
      if (!previousNavigator) delete globalThis.navigator;
    },
  };
}

/** A store whose setSettings replaces the object wholesale, like the real one. */
function createStore(initial) {
  let shared = { ...initial };
  return {
    getSettings: () => shared,
    setSettings: (settings) => { shared = { ...settings }; },
    peek: () => shared,
  };
}

/**
 * An api whose saveSettings snapshots the payload at SEND time, like IPC
 * does.
 *
 * `deferred` holds each save open until the returned `pending` list is
 * released — that is how a save can be kept in flight while the user does
 * something else.
 */
function createApi({ deferred = false } = {}) {
  const saved = [];
  const pending = [];
  return {
    saved,
    pending,
    api: {
      saveSettings(settings) {
        // The wire serialises now; the reply carries that snapshot.
        const snapshot = { ...settings };
        saved.push(snapshot);
        if (!deferred) return Promise.resolve(snapshot);
        return new Promise((resolve) => pending.push(() => resolve(snapshot)));
      },
      secretState: async () => 'missing',
      checkModelDownloaded: async () => true,
      getLanguages: async () => ({ input: [{ value: 'auto', label: 'Auto Detect' }], target: [{ value: 'en', label: 'English' }] }),
      detectGpu: async () => 'cpu',
      validateGeminiModel: async () => ({ ok: true, message: 'ok' }),
      downloadModel: async () => {},
      downloadEngine: async () => '/tmp/whisper-cli.exe',
      activateEngine: async () => '/tmp/whisper-cli.exe',
      engineStatus: async () => ({}),
      checkWhisperBinary: async () => true,
      selectWhisperBinary: async () => null,
      testDeepgramConnection: async () => ({ ok: true, message: 'ok' }),
      testSpeechmaticsConnection: async () => ({ ok: true, message: 'ok' }),
      getHistory: async () => ({ sessions: [] }),
      clearHistory: async () => ({ sessions: [] }),
      getRecordingState: async () => 'ready',
      deleteSecret: async () => true,
    },
  };
}

/** Build a DOM with the engine toggle group populated. */
function createSettingsDom() {
  const dom = createDom({});
  const engineGroup = dom.byId('engine-group');
  const local = dom.createButton({ className: 'toggle-btn active', dataset: { value: 'local' } });
  const deepgram = dom.createButton({ className: 'toggle-btn', dataset: { value: 'deepgram' } });
  engineGroup.append(local, deepgram);
  const modeGroup = dom.byId('mode-group');
  modeGroup.append(dom.createButton({ className: 'toggle-btn active', dataset: { mode: 'toggle' } }));
  const polishGroup = dom.byId('polish-group');
  polishGroup.append(dom.createButton({ className: 'toggle-btn active', dataset: { value: 'thorough' } }));
  const translationGroup = dom.byId('translation-group');
  translationGroup.append(dom.createButton({ className: 'toggle-btn', dataset: { value: 'off' } }));
  translationGroup.append(dom.createButton({ className: 'toggle-btn', dataset: { value: 'on' } }));
  const aiPolishGroup = dom.byId('ai-polish-group');
  aiPolishGroup.append(dom.createButton({ className: 'toggle-btn active', dataset: { value: 'off' } }));
  aiPolishGroup.append(dom.createButton({ className: 'toggle-btn', dataset: { value: 'on' } }));
  return dom;
}

test('the engine selection survives a save response carrying an older snapshot', async () => {
  const dom = createSettingsDom();
  const store = createStore(BASE_SETTINGS);
  const { api, saved, pending } = createApi({ deferred: true });
  const { form, restore } = loadForm(dom, store, api);
  try {
    await form.loadSettingsIntoUi(store.peek());
    form.wireSettingsControls();

    // 1. The user changes the accent colour: save #1 goes out with "local".
    dom.byId('accent-color').value = '#ff0000';
    dom.dispatch('accent-color', 'input');
    await tick();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].engine, 'local');

    // 2. The user picks Deepgram while save #1 is still in flight.
    const deepgram = dom.byId('engine-group').querySelectorAll('.toggle-btn')[1];
    dom.dispatch('engine-group', 'click', { target: deepgram });
    const active = dom.byId('engine-group').querySelectorAll('.toggle-btn.active')[0];
    assert.equal(active.dataset.value, 'deepgram', 'the UI shows the new choice');

    // 3. Save #1's response arrives carrying the OLD snapshot.
    pending[0]();
    await tick();
    await tick();

    // 4. The queued persist must carry the user's choice, not the old value.
    assert.equal(saved.length, 2, 'a second save was issued');
    assert.equal(saved[1].engine, 'deepgram');
  } finally {
    restore();
  }
});

test('a settings broadcast does not undo a translation toggle the user just made', async () => {
  const dom = createSettingsDom();
  const store = createStore(BASE_SETTINGS);
  // Saves resolve immediately, so the save asserted on below is the one issued
  // AFTER the broadcast — not the one issued before it.
  const { api, saved } = createApi();
  const { form, restore } = loadForm(dom, store, api);
  try {
    await form.loadSettingsIntoUi(store.peek());
    form.wireSettingsControls();

    // The user turns translation on.
    const on = dom.byId('translation-group').querySelectorAll('.toggle-btn')[1];
    dom.dispatch('translation-group', 'click', { target: on });
    await tick();
    await tick();

    // A broadcast arrives carrying an older snapshot (translation still off).
    form.applySettingsToUi({ ...store.peek(), translationEnabled: false });
    await tick();

    // The next save must still carry the user's choice.
    dom.byId('accent-color').value = '#ff0000';
    dom.dispatch('accent-color', 'input');
    await tick();
    await tick();
    await tick();

    const last = saved[saved.length - 1];
    assert.equal(last.translationEnabled, true, 'the translation toggle must survive the broadcast');
  } finally {
    restore();
  }
});
