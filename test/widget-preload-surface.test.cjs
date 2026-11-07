// test/widget-preload-surface.test.cjs
//
// preload.cjs picks the bridge it exposes from the page's PATH. Three pages get
// three different surfaces, and the widget must get a strictly smaller one than
// the main window: the capsule only drives recording, mirrors state and paints
// an accent colour, so it must never be able to save settings or touch secrets.
//
// The page identity must not depend on the query string: the widget's own
// documented dev hook is `widget.html?debug=listening`, and matching the raw
// href handed that restricted window the full main-window API (F2).
//
// `pagePath()` has two branches — `location.pathname` (primary, what Electron
// actually provides) and an href fallback for contexts that only expose href.
// Both are exercised explicitly below, so neither can be deleted unnoticed.
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
 * @param {{withPathname?: boolean}} [options] `withPathname: false` omits
 *   `location.pathname`, which forces `pagePath()`'s href fallback.
 * @returns {{api: object, exposed: object, onCalls: Array, sendCalls: Array, invokeCalls: Array}}
 */
function loadPreload(href, { withPathname = true } = {}) {
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
  const location = { href };
  if (withPathname) location.pathname = new URL(href).pathname;
  const sandbox = {
    window: { location },
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
    'startRecording', 'stopRecording', 'cancelRecording',
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

// ---------------------------------------------------------------------------
// F2 regression: the query string must never decide which bridge a page gets.
//
// Before the fix, `isWidgetPage()` tested `window.location.href`, so the
// widget's own documented dev hook (`?debug=listening`) fell through to
// `fullApi`: 39 keys including saveSettings, deleteSecret and startRecording,
// and no onMicLevel. Both `pagePath()` branches are covered separately below.
// ---------------------------------------------------------------------------

/** Capabilities the restricted floating windows must never have. */
const FORBIDDEN_ON_WIDGET = [
  'saveSettings', 'deleteSecret', 'hasSecret', 'secretState',
  'startRecording', 'stopRecording', 'cancelRecording', 'pauseRecording', 'resumeRecording',
  'copyText', 'getHistory', 'clearHistory', 'sendMicLevel',
  'onTranscriptionResult', 'onHotkeyPressed', 'onOverlayAction', 'windowControl',
];

const WIDGET_SUFFIXES = [
  ['?debug=listening', 'the documented dev hook'],
  ['?debug=', 'an empty debug value'],
  ['?', 'a bare question mark'],
  ['#frag', 'a bare fragment'],
  ['?debug=listening#frag', 'query plus fragment'],
  ['?debug=listening&x=1#f', 'multiple params plus fragment'],
];

const OVERLAY_SUFFIXES = [
  ['?anything=1', 'a query string'],
  ['?', 'a bare question mark'],
  ['#frag', 'a bare fragment'],
  ['?debug=x#y', 'query plus fragment'],
];

/** @param {object} api */
function assertWidgetBridge(api, label) {
  assert.deepEqual(Object.keys(api).sort(), WIDGET_KEYS, `${label}: wrong bridge surface`);
  assert.equal(typeof api.onMicLevel, 'function', `${label}: onMicLevel must survive`);
  for (const key of FORBIDDEN_ON_WIDGET) {
    assert.equal(api[key], undefined, `${label}: the widget must not expose ${key}`);
  }
}

/** @param {object} api */
function assertOverlayBridge(api, label) {
  assert.deepEqual(Object.keys(api).sort(), OVERLAY_KEYS, `${label}: wrong bridge surface`);
  assert.equal(api.onMicLevel, undefined, `${label}: the legacy overlay must not gain the widget feed`);
  assert.equal(api.sendMicLevel, undefined, `${label}: the legacy overlay must not gain sendMicLevel`);
}

test('widget.html + any query/hash still gets the six-key bridge (primary: location.pathname)', () => {
  for (const [suffix, label] of WIDGET_SUFFIXES) {
    const { api } = loadPreload(`${WIDGET_HREF}${suffix}`, { withPathname: true });
    assertWidgetBridge(api, `widget.html${suffix} (${label})`);
  }
});

test('widget.html + any query/hash still gets the six-key bridge (fallback: href only)', () => {
  for (const [suffix, label] of WIDGET_SUFFIXES) {
    const { api } = loadPreload(`${WIDGET_HREF}${suffix}`, { withPathname: false });
    assertWidgetBridge(api, `widget.html${suffix} (${label}, href fallback)`);
  }
});

test('overlay.html + any query/hash still gets the five-key bridge (primary: location.pathname)', () => {
  for (const [suffix, label] of OVERLAY_SUFFIXES) {
    const { api } = loadPreload(`${OVERLAY_HREF}${suffix}`, { withPathname: true });
    assertOverlayBridge(api, `overlay.html${suffix} (${label})`);
  }
});

test('overlay.html + any query/hash still gets the five-key bridge (fallback: href only)', () => {
  for (const [suffix, label] of OVERLAY_SUFFIXES) {
    const { api } = loadPreload(`${OVERLAY_HREF}${suffix}`, { withPathname: false });
    assertOverlayBridge(api, `overlay.html${suffix} (${label}, href fallback)`);
  }
});

test('both pagePath() branches agree for every page', () => {
  // If the fallback were deleted, this catches it; if the primary read were
  // deleted, the *branch* tests above catch it.
  const pages = [
    WIDGET_HREF, OVERLAY_HREF, MAIN_HREF,
    ...WIDGET_SUFFIXES.map(([suffix]) => `${WIDGET_HREF}${suffix}`),
    ...OVERLAY_SUFFIXES.map(([suffix]) => `${OVERLAY_HREF}${suffix}`),
  ];
  for (const href of pages) {
    const primary = Object.keys(loadPreload(href, { withPathname: true }).api).sort();
    const fallback = Object.keys(loadPreload(href, { withPathname: false }).api).sort();
    assert.deepEqual(fallback, primary, `the two pagePath() branches disagree for ${href}`);
  }
});

test('the page match is anchored: a path that merely contains widget.html is not the widget', () => {
  const base = 'file:///C:/Users/kim/Documents/GitHub/kimflow';

  // An overlay inside a directory whose name starts with widget.html: the
  // anchored `$` must still resolve it to the overlay, not the widget.
  assertOverlayBridge(loadPreload(`${base}/widget.html-backup/overlay.html`).api, 'widget.html-backup/overlay.html');

  // ...and the mirror image resolves to the widget.
  assertWidgetBridge(loadPreload(`${base}/overlay.html-backup/widget.html`).api, 'overlay.html-backup/widget.html');

  // Neither page: full API.
  for (const href of [`${base}/widget.html-backup/index.html`, `${base}/src/widget/widget.htmlx`]) {
    const { api } = loadPreload(href);
    assert.equal(typeof api.saveSettings, 'function', `${href} must not be treated as a floating page`);
    assert.equal(api.onMicLevel, undefined, `${href} must not be treated as the widget`);
  }

  // `widget.htm` is matched by the `html?` regex on purpose (unchanged).
  assertWidgetBridge(loadPreload(`${base}/src/widget/widget.htm`).api, 'widget.htm');
});

