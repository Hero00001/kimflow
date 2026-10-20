// test/hotkey-modifiers.test.cjs
//
// Electron's accelerator parser accepts more modifiers than KimFlow's
// whitelist did: Command, Cmd, Control, Ctrl, CommandOrControl, CmdOrCtrl,
// Alt, Option, AltGr, Shift, Super and Meta.
//
// Rejecting `Meta` or `Option` means the app refuses a perfectly valid
// accelerator — and since an unusable hotkey used to abort the entire
// settings save, that refusal locked the user out of saving anything.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { isValidHotkey, normalizeHotkey } = require('../backend/hotkeys.cjs');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

// Every modifier Electron documents.
const ELECTRON_MODIFIERS = [
  'Command', 'Cmd', 'Control', 'Ctrl', 'CommandOrControl', 'CmdOrCtrl',
  'Alt', 'Option', 'AltGr', 'Shift', 'Super', 'Meta',
];

test('accepts every modifier Electron supports', () => {
  for (const modifier of ELECTRON_MODIFIERS) {
    assert.equal(isValidHotkey(`${modifier}+Space`), true, `${modifier}+Space must be valid`);
  }
});

test('still rejects a lone modifier and a nonsense key', () => {
  assert.equal(isValidHotkey('Shift'), false);
  assert.equal(isValidHotkey('Ctrl+NotAKey'), false);
  assert.equal(isValidHotkey('Hyper+Space'), false);
});

test('normalization maps the cross-platform aliases onto real modifiers', () => {
  // Meta is Electron's alias for Super, and Option for Alt.
  assert.equal(normalizeHotkey('Meta+Space'), 'Super+Space');
  assert.equal(normalizeHotkey('Option+Space'), 'Alt+Space');
  // Command has no effect on Windows and Linux, so it must not be left
  // there: a hotkey recorded on Windows would silently bind the bare key.
  if (process.platform === 'darwin') {
    assert.equal(normalizeHotkey('Command+Space'), 'Command+Space');
  } else {
    assert.equal(normalizeHotkey('Command+Space'), 'Control+Space');
  }
});

test('the hotkey recorder emits a modifier Electron honours on this platform', () => {
  // The recorder used to emit "Command" for the meta key. Electron documents
  // that the Command modifier has NO effect on Windows and Linux, so a
  // Windows-key shortcut recorded that way silently bound the bare key.
  const dom = createDom({});
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  globalThis.document = dom.document;
  globalThis.window = { api: { saveSettings: async () => ({}), secretState: async () => 'missing' } };
  if (!previousNavigator) globalThis.navigator = { platform: 'Linux x86_64', userAgent: 'node' };
  const storePath = path.resolve('src/store.ts');
  try {
    const form = loadTs('src/settings-form.ts', (resolved) => (
      resolved === storePath ? { getSettings: () => ({ hotkey: '' }), setSettings() {} } : undefined
    ));
    form.wireSettingsControls();

    // Press the meta key plus Space.
    dom.dispatch('hotkey-record', 'click');
    dom.dispatch('hotkey-input', 'keydown', { key: ' ', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false });

    const recorded = dom.byId('hotkey-input').value;
    assert.ok(recorded.length > 0, 'a hotkey was recorded');
    const modifier = recorded.split('+')[0];
    assert.equal(
      isValidHotkey(recorded),
      true,
      `the recorded hotkey "${recorded}" must be one Electron accepts`,
    );
    if (process.platform !== 'darwin') {
      assert.notEqual(modifier, 'Command', 'Command has no effect off macOS');
    }
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    if (!previousNavigator) delete globalThis.navigator;
  }
});
