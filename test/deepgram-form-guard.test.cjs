// test/deepgram-form-guard.test.cjs
//
// The renderer guard for the removed Whisper (Cloud) model: a stored legacy
// value ('whisper', or anything unknown) must NOT point the model select at a
// nonexistent option — it maps back to 'auto', which the backend resolves to
// a concrete nova model per request.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

const BASE_SETTINGS = {
  microphone: 'default', engine: 'deepgram', whisperModel: 'small',
  whisperRuntime: 'whisper-cpp', whisperBinaryPath: '',
  deepgramApiKey: '', deepgramModel: 'auto', speechmaticsApiKey: '',
  recordingMode: 'toggle', polishMode: 'light', customVocabulary: [],
  aiPolish: false, hotkey: 'CmdOrCtrl+Shift+Space', accentColor: '#8b5cf6',
  translationEnabled: false, translationProvider: 'gemini', geminiApiKey: '',
  geminiModel: '', inputLanguage: 'auto', translationTarget: 'en',
  uiLanguage: 'en', useFlowBarWidget: true,
};

function createDom_() {
  const dom = createDom({});
  dom.byId('deepgram-key').dataset.i18nPlaceholder = 'settings.key.deepgramPlaceholder';
  dom.byId('speechmatics-key').dataset.i18nPlaceholder = 'settings.key.speechmaticsPlaceholder';
  dom.byId('gemini-key').dataset.i18nPlaceholder = 'settings.key.geminiKeyPlaceholder';
  return dom;
}

function createStore(initial) {
  let shared = { ...initial };
  return {
    getSettings: () => shared,
    setSettings: (settings) => { shared = { ...settings }; },
    peek: () => shared,
  };
}

function createApi() {
  return {
    api: {
      saveSettings: async (settings) => ({ ...settings }),
      secretState: async () => 'missing',
      checkModelDownloaded: async () => true,
      getLanguages: async () => ({ input: [], target: [] }),
      detectGpu: async () => 'cpu',
      engineStatus: async () => ({}),
      checkWhisperBinary: async () => true,
      selectWhisperBinary: async () => null,
      validateGeminiModel: async () => ({ ok: true, message: 'ok' }),
      getRecordingState: async () => 'ready',
      deleteSecret: async () => true,
    },
  };
}

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

test('a stored legacy whisper model loads into the select as auto', async () => {
  const dom = createDom_();
  const store = createStore({ ...BASE_SETTINGS, deepgramModel: 'whisper' });
  const { api } = createApi();
  const { form, restore } = loadForm(dom, store, api);
  try {
    await form.loadSettingsIntoUi({ ...BASE_SETTINGS, deepgramModel: 'whisper' });
    assert.equal(dom.byId('deepgram-model-select').value, 'auto',
      "a stored 'whisper' must select the 'auto' option, never a nonexistent one");
  } finally {
    restore();
  }
});

test('every whitelisted model value selects itself, unknown values fall back to auto', async () => {
  for (const [stored, expected] of [
    ['auto', 'auto'], ['nova-3', 'nova-3'], ['nova-2', 'nova-2'],
    ['turbo', 'auto'], ['', 'auto'], [undefined, 'auto'],
  ]) {
    const dom = createDom_();
    const store = createStore(BASE_SETTINGS);
    const { api } = createApi();
    const { form, restore } = loadForm(dom, store, api);
    try {
      await form.loadSettingsIntoUi({ ...BASE_SETTINGS, deepgramModel: stored });
      assert.equal(dom.byId('deepgram-model-select').value, expected,
        `stored ${JSON.stringify(stored)} must select "${expected}"`);
    } finally {
      restore();
    }
  }
});
