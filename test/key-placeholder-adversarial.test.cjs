// test/key-placeholder-adversarial.test.cjs
//
// The placeholder-mirroring UX (b0e58ca): the key status is mirrored into the
// key inputs' placeholders, reusing the existing i18n keys. saved / volatile /
// unreadable show the status text; missing / unavailable restore the original
// static placeholder from the input's `data-i18n-placeholder` key. A failure
// inside the placeholder logic must never propagate — it is decoration.
//
// The REAL src/settings-form.ts is loaded against the DOM stub (same harness
// pattern as settings-state-ownership.test.cjs), only `./store` stubbed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

const EN = loadTs('src/i18n/locales/en.ts').en;

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

const KEY_INPUT_IDS = {
  deepgramApiKey: 'deepgram-key',
  speechmaticsApiKey: 'speechmatics-key',
  geminiApiKey: 'gemini-key',
};

// The ORIGINAL static placeholder keys, exactly as index.html declares them.
const PLACEHOLDER_KEYS = {
  deepgramApiKey: 'settings.key.deepgramPlaceholder',
  speechmaticsApiKey: 'settings.key.speechmaticsPlaceholder',
  geminiApiKey: 'settings.key.geminiKeyPlaceholder',
};

function createKeyDom() {
  const dom = createDom({});
  for (const [name, key] of Object.entries(PLACEHOLDER_KEYS)) {
    dom.byId(KEY_INPUT_IDS[name]).dataset.i18nPlaceholder = key;
  }
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

function createApi({ secretStateImpl = async () => 'missing' } = {}) {
  return {
    api: {
      saveSettings: async (settings) => ({ ...settings }),
      secretState: secretStateImpl,
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

/** Run refreshAllKeyStatus (via a broadcast) and settle its async work. */
async function refreshKeyStatuses(form, settings) {
  form.applySettingsToUi(settings);
  await tick();
  await tick();
  await tick();
}

test('saved / volatile / unreadable mirror the status text into the placeholder', async (t) => {
  for (const state of ['saved', 'volatile', 'unreadable']) {
    const dom = createKeyDom();
    const store = createStore(BASE_SETTINGS);
    const { api } = createApi({ secretStateImpl: async () => state });
    const { form, restore } = loadForm(dom, store, api);
    try {
      await refreshKeyStatuses(form, BASE_SETTINGS);
      const input = dom.byId(KEY_INPUT_IDS.deepgramApiKey);
      assert.equal(input.placeholder, EN[`settings.key.${state}`],
        `state "${state}" must mirror its i18n text into the placeholder`);
      assert.equal(dom.byId('deepgram-key-status').textContent, EN[`settings.key.${state}`]);
    } finally {
      restore();
    }
  }
});

test('missing restores the original data-i18n-placeholder value', async (t) => {
  const dom = createKeyDom();
  const store = createStore(BASE_SETTINGS);
  // First a state that OWNS the placeholder, then back to missing: the
  // original static placeholder must come back.
  const states = ['saved', 'missing'];
  const { api } = createApi({ secretStateImpl: async () => states.shift() || 'missing' });
  const { form, restore } = loadForm(dom, store, api);
  try {
    await refreshKeyStatuses(form, BASE_SETTINGS);
    const input = dom.byId(KEY_INPUT_IDS.deepgramApiKey);
    assert.equal(input.placeholder, EN['settings.key.saved'], 'sanity: saved owns the placeholder');

    await refreshKeyStatuses(form, BASE_SETTINGS);
    assert.equal(input.placeholder, EN['settings.key.deepgramPlaceholder'],
      'missing must restore the original static placeholder');
  } finally {
    restore();
  }
});

test('a secretState rejection degrades to "unavailable" and still restores the original placeholder', async (t) => {
  const dom = createKeyDom();
  const store = createStore(BASE_SETTINGS);
  const { api } = createApi({ secretStateImpl: async () => { throw new Error('IPC down'); } });
  const { form, restore } = loadForm(dom, store, api);
  try {
    await refreshKeyStatuses(form, BASE_SETTINGS);
    assert.equal(dom.byId('deepgram-key-status').textContent, EN['settings.key.unavailable']);
    assert.equal(dom.byId(KEY_INPUT_IDS.deepgramApiKey).placeholder,
      EN['settings.key.deepgramPlaceholder']);
  } finally {
    restore();
  }
});

test('a throw inside the placeholder logic never propagates and the status text still lands', async (t) => {
  const dom = createKeyDom();
  const store = createStore(BASE_SETTINGS);
  const { api } = createApi({ secretStateImpl: async () => 'saved' });
  const { form, restore } = loadForm(dom, store, api);
  try {
    // Make reading `dataset` (applyKeyPlaceholder's first access) explode.
    const input = dom.byId(KEY_INPUT_IDS.deepgramApiKey);
    Object.defineProperty(input, 'dataset', {
      configurable: true,
      get() { throw new Error('dataset is on fire'); },
    });
    // Must not reject: applyKeyPlaceholder swallows its own failures.
    await refreshKeyStatuses(form, BASE_SETTINGS);
    assert.equal(dom.byId('deepgram-key-status').textContent, EN['settings.key.saved'],
      'the status text above the input must be set even when the placeholder logic throws');
  } finally {
    restore();
  }
});

test('all three key inputs get their placeholders refreshed, not just deepgram', async (t) => {
  const dom = createKeyDom();
  const store = createStore(BASE_SETTINGS);
  const states = { deepgramApiKey: 'saved', speechmaticsApiKey: 'volatile', geminiApiKey: 'unreadable' };
  const { api } = createApi({ secretStateImpl: async (name) => states[name] });
  const { form, restore } = loadForm(dom, store, api);
  try {
    await refreshKeyStatuses(form, BASE_SETTINGS);
    assert.equal(dom.byId(KEY_INPUT_IDS.deepgramApiKey).placeholder, EN['settings.key.saved']);
    assert.equal(dom.byId(KEY_INPUT_IDS.speechmaticsApiKey).placeholder, EN['settings.key.volatile']);
    assert.equal(dom.byId(KEY_INPUT_IDS.geminiApiKey).placeholder, EN['settings.key.unreadable']);
  } finally {
    restore();
  }
});
