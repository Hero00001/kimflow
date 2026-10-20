// test/gemini-key-field.test.cjs
//
// Regression test for the CRITICAL defect: the Gemini API key was corrupted
// in the OS keychain.
//
// backend/settings.cjs blanks the key fields before returning them (by
// design — key values never leave the main process). The renderer then wrote
// that blanked value back into the very input the user was typing into. The
// Gemini key input has a 500 ms debounced save, so:
//
//   1. the user types "AIzaSy" and pauses
//   2. the debounce fires, the keychain stores "AIzaSy", the broadcast blanks
//      the input
//   3. the user keeps typing "ABC123" — but the input now only holds
//      "ABC123", so the keychain is OVERWRITTEN with "ABC123"
//
// The key inputs are write-only. A settings payload must never repopulate
// them.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

const DOM_IDS = [
  'gemini-key', 'gemini-model', 'gemini-model-status', 'provider-select',
  'input-language-select', 'translate-to-select', 'translation-group',
];

/**
 * Load src/translation.ts against a fake DOM so the key inputs are
 * observable, and against a fake store that reports the blanked settings the
 * backend actually returns.
 */
function loadTranslation(dom, settings) {
  const domPath = path.resolve('src/dom.ts');
  const storePath = path.resolve('src/store.ts');
  const cache = new Map();
  const translation = loadTs('src/translation.ts', (resolved) => {
    if (resolved === domPath) return dom.exports([
      'translationArea', 'translationError', 'translationText', 'providerRow',
      'translateToRow', 'providerSelect', 'inputLanguageSelect',
      'translateToSelect', 'geminiKey', 'geminiModel', 'geminiModelStatus',
      'translationGroup', 'copyTranslationBtn',
    ]);
    if (resolved === storePath) return { getSettings: () => settings };
    return undefined;
  }, cache);
  return translation;
}

function createSettingsDom() {
  const dom = createDom(Object.fromEntries(DOM_IDS.map((id) => [id, {}])));
  // The backend blanks key fields before returning them.
  dom.byId('gemini-key').value = '';
  return dom;
}

test('syncTranslationControls does not blank a key the user is typing', () => {
  const dom = createSettingsDom();
  const translation = loadTranslation(dom, {
    geminiApiKey: '', geminiModel: '', translationProvider: 'gemini',
    inputLanguage: 'auto', translationTarget: 'en', translationEnabled: true,
  });
  dom.byId('gemini-key').value = 'AIzaSy-user-typed';
  translation.syncTranslationControls();
  assert.equal(dom.byId('gemini-key').value, 'AIzaSy-user-typed');
});

test('syncTranslationControls leaves a partially typed key alone', () => {
  const dom = createSettingsDom();
  const translation = loadTranslation(dom, {
    geminiApiKey: '', geminiModel: '', translationProvider: 'gemini',
    inputLanguage: 'auto', translationTarget: 'en', translationEnabled: true,
  });
  // Exactly the state the debounced save would leave behind.
  dom.byId('gemini-key').value = 'AIzaSy';
  translation.syncTranslationControls();
  assert.equal(dom.byId('gemini-key').value, 'AIzaSy');
});

test('a full key survives a settings broadcast unchanged', () => {
  const dom = createSettingsDom();
  const translation = loadTranslation(dom, {
    geminiApiKey: '', geminiModel: '', translationProvider: 'gemini',
    inputLanguage: 'auto', translationTarget: 'en', translationEnabled: true,
  });
  dom.byId('gemini-key').value = 'AIzaSyABC123';
  translation.syncTranslationControls();
  assert.equal(dom.byId('gemini-key').value, 'AIzaSyABC123');
});

test('every key input is write-only, not just the Gemini one', async () => {
  // The same wipe could be reintroduced for the other two key fields, which
  // have no write-back in `syncTranslationControls` but used to be
  // repopulated by `loadSettingsIntoUi`. Assert the whole set.
  const dom = createDom({});
  const storePath = path.resolve('src/store.ts');
  const domPath = path.resolve('src/dom.ts');
  const cache = new Map();
  const form = loadTs('src/settings-form.ts', (resolved) => {
    if (resolved === domPath) {
      // Every element name resolves lazily, so the test does not have to
      // enumerate the ids the renderer imports.
      return dom.exports();
    }
    if (resolved === storePath) {
      return {
        getSettings: () => ({
          microphone: 'default', engine: 'local', whisperModel: 'small',
          whisperRuntime: 'whisper-cpp', whisperBinaryPath: '',
          deepgramApiKey: '', deepgramModel: 'nova-3', speechmaticsApiKey: '',
          recordingMode: 'toggle', polishMode: 'thorough', customVocabulary: [],
          aiPolish: false, hotkey: 'CmdOrCtrl+Shift+Space', accentColor: '#8b5cf6',
          translationEnabled: false, translationProvider: 'gemini',
          geminiApiKey: '', geminiModel: '', inputLanguage: 'auto',
          translationTarget: 'en', uiLanguage: 'en',
        }),
        setSettings() {},
      };
    }
    return undefined;
  }, cache);

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  globalThis.document = dom.document;
  globalThis.window = {
    api: {
      secretState: async () => 'missing',
      checkModelDownloaded: async () => true,
      getLanguages: async () => ({ input: [], target: [] }),
      detectGpu: async () => 'cpu',
      engineStatus: async () => ({}),
    },
    setTimeout,
    clearTimeout,
  };
  if (!previousNavigator) globalThis.navigator = { platform: 'Linux x86_64', userAgent: 'node' };
  try {
    await form.loadSettingsIntoUi({
      microphone: 'default', engine: 'local', whisperModel: 'small',
      whisperRuntime: 'whisper-cpp', whisperBinaryPath: '',
      // A backend that somehow still returned a key value must not write it
      // into the field.
      deepgramApiKey: 'should-not-appear', speechmaticsApiKey: 'should-not-appear',
      geminiApiKey: 'should-not-appear',
      deepgramModel: 'nova-3', recordingMode: 'toggle', polishMode: 'thorough',
      customVocabulary: [], aiPolish: false, hotkey: 'CmdOrCtrl+Shift+Space',
      accentColor: '#8b5cf6', translationEnabled: false, translationProvider: 'gemini',
      geminiModel: '', inputLanguage: 'auto', translationTarget: 'en', uiLanguage: 'en',
    });
    assert.equal(dom.byId('deepgram-key').value, '', 'the Deepgram key input stays empty');
    assert.equal(dom.byId('speechmatics-key').value, '', 'the Speechmatics key input stays empty');
    assert.equal(dom.byId('gemini-key').value, '', 'the Gemini key input stays empty');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    if (!previousNavigator) delete globalThis.navigator;
  }
});
