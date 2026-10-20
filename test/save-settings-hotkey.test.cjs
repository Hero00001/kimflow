// test/save-settings-hotkey.test.cjs
//
// Regression test for the HIGH defect: a hotkey owned by another application
// made the whole app unconfigurable.
//
// `main.cjs` threw before `saveSettings` ran, so while the capture hotkey was
// unavailable EVERY settings save failed — including the one that saves the
// user's API key. The thrown message was not in the locale table, so the UI
// showed a generic "Unable to save settings" with no explanation.
//
// The fix: register the hotkey first, and when it cannot be registered, fall
// back to the hotkey that is actually working so the app stays usable. The
// saved settings then carry a hotkey different from the one requested, and
// the renderer reports that.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');
const { createDom } = require('./helpers/dom-stub.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');

function withTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-hotkey-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });
  return home;
}

function readConfig(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.kimflow', 'config.json'), 'utf8'));
}

/** A hotkey stub whose registration always fails, as if another app owns it. */
function unavailableHotkey() {
  return {
    registerHotkeys: () => false,
    unregisterHotkeys: () => {},
    setHotkeyCallbacks: () => {},
    isValidHotkey: () => true,
    getActiveHotkey: () => 'Ctrl+Alt+Space',
  };
}

test('a taken hotkey does not stop the other settings from being saved', async (t) => {
  const home = withTempHome(t);
  const harness = await loadMain({
    locale: 'en-US',
    home,
    overrides: { 'hotkeys.cjs': unavailableHotkey() },
  });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };

  // The hotkey failure is reported, but the save already happened.
  await assert.rejects(
    () => harness.handlers.get('save-settings')(event, {
      engine: 'deepgram',
      accentColor: '#123456',
      hotkey: 'Ctrl+Shift+Space',
    }),
    /hotkey/i,
  );

  // The settings the user changed must be persisted.
  const onDisk = readConfig(home);
  assert.equal(onDisk.engine, 'deepgram');
  assert.equal(onDisk.accentColor, '#123456');
});

test('the hotkey falls back to the one that is actually working', async (t) => {
  const home = withTempHome(t);
  const harness = await loadMain({
    locale: 'en-US',
    home,
    overrides: { 'hotkeys.cjs': unavailableHotkey() },
  });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };

  await assert.rejects(
    () => harness.handlers.get('save-settings')(event, { hotkey: 'Ctrl+Shift+Space' }),
    /hotkey/i,
  );

  // The app must keep a hotkey that actually works, so the user is not left
  // with no capture shortcut at all.
  assert.equal(readConfig(home).hotkey, 'Ctrl+Alt+Space');
});

test('a hotkey that registers is saved as requested', async (t) => {
  const home = withTempHome(t);
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };

  const saved = await harness.handlers.get('save-settings')(event, {
    hotkey: 'Ctrl+Shift+Space',
  });

  assert.equal(saved.hotkey, 'Ctrl+Shift+Space');
  assert.equal(readConfig(home).hotkey, 'Ctrl+Shift+Space');
});

test('a hotkey that cannot be applied is reported even with no fallback', async (t) => {
  const home = withTempHome(t);
  // No hotkey is registered and none can be: the user picked a shortcut
  // another application owns. The app must say so — not silently keep an
  // unusable shortcut and only mention it at the next launch.
  const harness = await loadMain({
    locale: 'en-US',
    home,
    overrides: {
      'hotkeys.cjs': {
        registerHotkeys: () => false,
        unregisterHotkeys: () => {},
        setHotkeyCallbacks: () => {},
        isValidHotkey: () => true,
        getActiveHotkey: () => '',
      },
    },
  });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };

  // The other settings are still saved, and the failure is reported.
  let thrown = null;
  try {
    await harness.handlers.get('save-settings')(event, { engine: 'deepgram', hotkey: 'Ctrl+Shift+Space' });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'the unusable hotkey must be reported, not silently kept');
  assert.match(thrown.message, /hotkey/i);
  assert.equal(readConfig(home).engine, 'deepgram', 'the other settings must still be saved');
});

test('the renderer tells the user when the hotkey could not be applied', async () => {
  const dom = createDom({});
  const errors = [];
  const saved = [];
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.document;
  globalThis.window = {
    api: {
      // The main process saved the settings and then reported that the
      // shortcut could not be claimed. The broadcast that carried the
      // effective hotkey arrives before the rejection.
      saveSettings: async (settings) => {
        saved.push({ ...settings });
        shared = { ...shared, hotkey: 'Ctrl+Alt+Space' };
        throw new Error('Capture hotkey could not be applied - another application may already use it, or it may be invalid. Your other settings were saved.');
      },
      secretState: async () => 'missing',
      checkModelDownloaded: async () => true,
      getLanguages: async () => ({ input: [], target: [] }),
      detectGpu: async () => 'cpu',
    },
    setTimeout,
    clearTimeout,
  };
  const storePath = path.resolve('src/store.ts');
  const statusPath = path.resolve('src/status.ts');
  // The store holds the hotkey that is actually in effect.
  let shared = { hotkey: 'Ctrl+Alt+Space', engine: 'local' };
  try {
    const form = loadTs('src/settings-form.ts', (resolved) => {
      if (resolved === storePath) {
        return { getSettings: () => shared, setSettings: (s) => { shared = { ...s }; } };
      }
      if (resolved === statusPath) {
        return {
          showError: (message) => errors.push(message),
          showToast() {},
          refreshStatusText() {},
          onStateChange: () => () => {},
          getCurrentState: () => 'ready',
          STATES: { READY: 'ready', RECORDING: 'recording', PAUSED: 'paused', TRANSCRIBING: 'transcribing' },
        };
      }
      return undefined;
    });
    form.wireSettingsControls();

    dom.byId('hotkey-input').value = 'Ctrl+Shift+Space';
    dom.dispatch('hotkey-input', 'change');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(saved.length, 1, 'a save was attempted');
    assert.equal(errors.length, 1, 'the user was told');
    assert.match(errors[0], /hotkey/i);
    // The field must show the hotkey that is actually in effect.
    assert.equal(dom.byId('hotkey-input').value, 'Ctrl+Alt+Space');
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});
