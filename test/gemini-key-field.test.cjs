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
