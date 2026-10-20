// test/review-fixes-2.test.cjs
//
// Second review round. Three defects the reviews confirmed, plus the DOM
// stub's fidelity gaps.
//
// 1. `test/settings-state-ownership.test.cjs` had a test that PASSED against
//    the reverted code: it never resolved the pending save, so the save it
//    asserted on was the one taken BEFORE the broadcast. A test that cannot
//    fail is not a test.
//
// 2. Switching to a downloaded engine left the shared store holding the OLD
//    binary path, so "Recheck" validated the previous (possibly deleted)
//    file and showed a false failure next to the new engine.
//
// 3. The DOM stub modelled `classList` -> `className` but not the reverse, so
//    `element.className = ''` (how src/status.ts clears its state classes)
//    left the old classes behind. It also lacked `appendChild` and did not
//    understand attribute selectors, which made `renderStatic()` a no-op.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

// ── 3. DOM stub fidelity ────────────────────────────────────────────────────

test('the stub clears classes when className is assigned', () => {
  const dom = createDom({ 'dot': { className: 'recording' } });
  const dot = dom.byId('dot');
  dot.className = '';
  assert.equal(dot.className, '', 'className is the source of truth here');
  assert.equal(dot.classList.contains('recording'), false, 'the old class must be gone');
});

test('the stub supports appendChild', () => {
  const dom = createDom({ 'list': {} });
  const child = dom.createElement({ tagName: 'SPAN' });
  dom.byId('list').appendChild(child);
  assert.equal(dom.byId('list').children.length, 1);
  assert.equal(dom.byId('list').children[0], child);
});

test('the stub matches attribute selectors', () => {
  const dom = createDom({});
  const element = dom.createElement({});
  element.setAttribute('data-i18n', 'status.ready');
  dom.byId('body').appendChild(element);
  assert.equal(dom.byId('body').querySelectorAll('[data-i18n]').length, 1);
});

// ── 2. the store must not keep a stale binary path ─────────────────────────

test('the shared store follows the engine that was just installed', async () => {
  const dom = createDom({});
  const api = createApi();
  const shared = { current: FULL_SETTINGS() };
  const { form, restore } = loadForm(dom, shared, api);
  try {
    await form.loadSettingsIntoUi(shared.current);
    form.wireSettingsControls();

    // The main process reports the engine it installed.
    api.nextBinaryPath = 'C:/engines/cpu/Release/whisper-cli.exe';
    dom.dispatch('engine-cpu-btn', 'click');
    for (let i = 0; i < 8; i += 1) await tick();

    assert.equal(
      shared.current.whisperBinaryPath,
      'C:/engines/cpu/Release/whisper-cli.exe',
      'the store must hold the binary that is actually in use',
    );
  } finally {
    restore();
  }
});

/** A complete settings object, as the backend always returns. */
function FULL_SETTINGS() {
  return {
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
}

// ── helpers ─────────────────────────────────────────────────────────────────

function createApi() {
  const api = {
    saved: [],
    nextBinaryPath: '',
    saveSettings: async (settings) => {
      const snapshot = { ...settings };
      api.saved.push(snapshot);
      return snapshot;
    },
    secretState: async () => 'missing',
    checkModelDownloaded: async () => true,
    getLanguages: async () => ({ input: [], target: [] }),
    detectGpu: async () => 'cpu',
    engineStatus: async () => ({}),
    downloadEngine: async () => {
      const next = api.nextBinaryPath;
      api.nextBinaryPath = '';
      return next;
    },
    activateEngine: async () => '',
  };
  return api;
}

function loadForm(dom, shared, api) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  globalThis.document = dom.document;
  globalThis.window = { api, setTimeout, clearTimeout, requestAnimationFrame: (fn) => setTimeout(fn, 0) };
  if (!previousNavigator) globalThis.navigator = { platform: 'Linux x86_64', userAgent: 'node' };
  const storePath = path.resolve('src/store.ts');
  const statusPath = path.resolve('src/status.ts');
  const cache = new Map();
  const form = loadTs('src/settings-form.ts', (resolved) => {
    if (resolved === storePath) {
      return {
        getSettings: () => shared.current,
        setSettings: (settings) => { shared.current = { ...settings }; },
      };
    }
    if (resolved === statusPath) {
      return {
        showError() {},
        showToast() {},
        refreshStatusText() {},
        onStateChange: () => () => {},
        getCurrentState: () => 'ready',
        STATES: { READY: 'ready', RECORDING: 'recording', PAUSED: 'paused', TRANSCRIBING: 'transcribing' },
      };
    }
    return undefined;
  }, cache);
  return {
    form,
    restore() {
      globalThis.document = previousDocument;
      globalThis.window = previousWindow;
      if (!previousNavigator) delete globalThis.navigator;
    },
  };
}
