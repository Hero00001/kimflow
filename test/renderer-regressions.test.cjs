// test/renderer-regressions.test.cjs
//
// Regressions found by self-review of the renderer changes (the independent
// renderer review was cancelled, so these were checked by reading the code).
//
// The settings form used to apply a settings snapshot over every editable
// control, which is what clobbered the user's in-progress edits. Reducing
// `applySettingsToUi` to the refreshes that cannot lose information also
// removed one thing it WAS responsible for: the read-only hotkey display did
// not follow the hotkey the user recorded.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Load src/settings-form.ts against a fake DOM and a controllable store.
 * Only `./store` and `./status` are stubbed; every other module is the real
 * one, so the test exercises the production settings code.
 */
function loadForm(dom, store, api) {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  globalThis.document = dom.document;
  globalThis.window = { api };
  if (!previousNavigator) globalThis.navigator = { platform: 'Linux x86_64', userAgent: 'node' };
  const storePath = path.resolve('src/store.ts');
  const statusPath = path.resolve('src/status.ts');
  const cache = new Map();
  const form = loadTs('src/settings-form.ts', (resolved) => {
    if (resolved === storePath) return store;
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

function createStore(initial) {
  let shared = { ...initial };
  return {
    getSettings: () => shared,
    setSettings: (settings) => { shared = { ...settings }; },
    peek: () => shared,
  };
}

function createApi() {
  const saved = [];
  return {
    saved,
    api: {
      saveSettings: async (settings) => {
        const snapshot = { ...settings };
        saved.push(snapshot);
        return snapshot;
      },
      secretState: async () => 'missing',
      checkModelDownloaded: async () => true,
      getLanguages: async () => ({ input: [], target: [] }),
      detectGpu: async () => 'cpu',
    },
  };
}

test('the hotkey display follows the hotkey the user recorded', async () => {
  const dom = createDom({});
  const store = createStore({ hotkey: 'Ctrl+Shift+Space' });
  const { api } = createApi();
  const { form, restore } = loadForm(dom, store, api);
  try {
    await form.loadSettingsIntoUi(store.peek());
    form.wireSettingsControls();

    assert.equal(dom.byId('hotkey-display').textContent, 'Ctrl+Shift+Space');

    // The user types a new hotkey.
    dom.byId('hotkey-input').value = 'Ctrl+Alt+Space';
    dom.dispatch('hotkey-input', 'change');
    await tick();
    await tick();

    assert.equal(
      dom.byId('hotkey-display').textContent,
      'Ctrl+Alt+Space',
      'the read-only display must show the hotkey that was saved',
    );
  } finally {
    restore();
  }
});
