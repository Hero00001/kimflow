// test/widget-preload-surface.test.cjs
//
// preload.cjs picks the bridge it exposes from `window.location.href`. Three
// pages get three different surfaces, and the widget must get a strictly
// smaller one than the main window: the capsule only drives recording, mirrors
// state and paints an accent colour, so it must never be able to save settings
// or touch secrets.
//
// The preload is evaluated in a vm sandbox with a fake `electron` module so the
// real file (not a copy) is what gets inspected.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PRELOAD_PATH = path.resolve(__dirname, '..', 'preload.cjs');

const WIDGET_HREF = 'file:///C:/Users/kim/Documents/GitHub/kimflow/src/widget/widget.html';
const OVERLAY_HREF = 'file:///C:/Users/kim/Documents/GitHub/kimflow/src/overlay.html';
const MAIN_HREF = 'file:///C:/Users/kim/Documents/GitHub/kimflow/dist/index.html';

/**
 * Evaluate the real preload.cjs against a fake Electron module.
 *
 * @param {string} href value of window.location.href
 * @returns {{api: object, exposed: object, onCalls: Array, sendCalls: Array, invokeCalls: Array}}
 */
function loadPreload(href) {
  const code = fs.readFileSync(PRELOAD_PATH, 'utf8');
  const exposed = {};
  const onCalls = [];
  const sendCalls = [];
  const invokeCalls = [];
  const electron = {
    contextBridge: {
      exposeInMainWorld(key, api) { exposed[key] = api; },
    },
    ipcRenderer: {
      on(channel, handler) { onCalls.push({ channel, handler }); },
      removeListener(channel, handler) { onCalls.push({ channel, handler, removed: true }); },
      send(channel, ...args) { sendCalls.push({ channel, args }); },
      invoke(channel, ...args) { invokeCalls.push({ channel, args }); return Promise.resolve(); },
    },
  };
  const sandbox = {
    window: { location: { href } },
    require(request) {
      if (request === 'electron') return electron;
      throw new Error(`unexpected require: ${request}`);
    },
    module: { exports: {} },
    exports: {},
    console,
  };
  vm.runInNewContext(code, sandbox, { filename: 'preload.cjs' });
  return { api: exposed.api, exposed, onCalls, sendCalls, invokeCalls };
}

const WIDGET_KEYS = [
  'getRecordingState',
  'getSettings',
  'onMicLevel',
  'onRecordingState',
  'onSettingsUpdated',
  'overlayAction',
];
const OVERLAY_KEYS = [
  'getRecordingState',
  'getSettings',
  'onRecordingState',
  'onSettingsUpdated',
  'overlayAction',
];

test('the widget page gets exactly the six documented keys', () => {
  const { api, exposed } = loadPreload(WIDGET_HREF);
  assert.deepEqual(Object.keys(exposed), ['api'], 'the bridge must be exposed as window.api');
  assert.deepEqual(Object.keys(api).sort(), WIDGET_KEYS);
});

test('the widget page cannot save settings, touch secrets or start a recording', () => {
  const { api } = loadPreload(WIDGET_HREF);
  const forbidden = [
    'saveSettings', 'deleteSecret', 'hasSecret', 'secretState',
    'startRecording', 'stopRecording', 'toggleRecording', 'cancelRecording',
    'pauseRecording', 'resumeRecording', 'sendMicLevel',
    'copyText', 'getHistory', 'clearHistory', 'onTranscriptionResult',
    'onHotkeyPressed', 'onOverlayAction', 'windowControl',
  ];
  for (const key of forbidden) {
    assert.equal(api[key], undefined, `the widget must not expose ${key}`);
  }
});

test('the legacy overlay page keeps exactly its six keys and gains nothing', () => {
  const { api } = loadPreload(OVERLAY_HREF);
  assert.deepEqual(Object.keys(api).sort(), OVERLAY_KEYS);
  assert.equal(api.onMicLevel, undefined, 'the legacy overlay must not gain the widget feed');
  assert.equal(api.sendMicLevel, undefined);
});

test('the main page gets the full API including sendMicLevel', () => {
  const { api } = loadPreload(MAIN_HREF);
  const keys = Object.keys(api);
  assert.ok(keys.length > 30, `expected the full surface, got ${keys.length} keys`);
  for (const key of ['sendMicLevel', 'saveSettings', 'startRecording', 'stopRecording', 'onTranscriptionResult', 'deleteSecret']) {
    assert.equal(typeof api[key], 'function', `main window is missing ${key}`);
  }
});

test('sendMicLevel is a one-way send on the mic-level channel, not an invoke', () => {
  const { api, sendCalls, invokeCalls } = loadPreload(MAIN_HREF);
  api.sendMicLevel(0.42);
  assert.deepEqual(sendCalls, [{ channel: 'mic-level', args: [0.42] }]);
  assert.deepEqual(invokeCalls, [], 'mic-level must never use invoke (main registers ipcMain.on)');
});

test('onMicLevel subscribes to widget-level and returns an unsubscribe', () => {
  const { api, onCalls } = loadPreload(WIDGET_HREF);
  const seen = [];
  const unsubscribe = api.onMicLevel((value) => seen.push(value));

  const subscription = onCalls.find((call) => call.channel === 'widget-level' && !call.removed);
  assert.ok(subscription, 'onMicLevel must subscribe to the widget-level channel');

  // The preload wraps the raw (event, value) signature into value-only.
  subscription.handler({ sender: 'ignored' }, 0.7);
  assert.deepEqual(seen, [0.7]);

  assert.equal(typeof unsubscribe, 'function');
  unsubscribe();
  const removal = onCalls.find((call) => call.channel === 'widget-level' && call.removed);
  assert.ok(removal, 'the unsubscribe must remove the same handler');
  assert.equal(removal.handler, subscription.handler);
});

test('the widget and overlay bridges are aliases of fullApi, not re-implementations', () => {
  // A re-implementation could drift (different channel name, extra argument).
  // Assert structurally that every shared key is `fullApi.<same name>`.
  const source = fs.readFileSync(PRELOAD_PATH, 'utf8');

  /** @param {string} name block name, e.g. 'widgetApi' */
  function blockBody(name) {
    const match = new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(source);
    assert.ok(match, `preload.cjs no longer defines ${name}`);
    return match[1];
  }

  for (const [name, keys] of [
    ['widgetApi', ['overlayAction', 'getRecordingState', 'getSettings', 'onRecordingState', 'onSettingsUpdated']],
    ['overlayApi', ['overlayAction', 'getRecordingState', 'getSettings', 'onRecordingState', 'onSettingsUpdated']],
  ]) {
    const body = blockBody(name);
    for (const key of keys) {
      assert.ok(
        new RegExp(`\\b${key}:\\s*fullApi\\.${key}\\b`).test(body),
        `${name}.${key} must alias fullApi.${key}`,
      );
    }
  }
  // onMicLevel is the only new capability and must come from subscribe(), so
  // the widget feed is not a second, unmanaged listener path.
  assert.match(blockBody('widgetApi'), /onMicLevel:\s*\(callback\)\s*=>\s*subscribe\('widget-level', callback\)/);
});

test('an unknown page still gets the full API (no accidental lockout)', () => {
  const { api } = loadPreload('file:///C:/Users/kim/Documents/GitHub/kimflow/dist/index.html?x=1');
  assert.equal(typeof api.sendMicLevel, 'function');
  assert.equal(typeof api.saveSettings, 'function');
});
