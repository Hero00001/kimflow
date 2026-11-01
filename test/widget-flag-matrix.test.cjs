// test/widget-flag-matrix.test.cjs
//
// `useFlowBarWidget` is the rollback switch for the floating UI, and it has two
// inputs: the persisted setting and the `KIMFLOW_FLOWBAR` environment variable.
// test/widget-entry.test.cjs covers the two obvious combinations; this file
// pins down the whole matrix, including the ones where the two inputs
// disagree, and then proves that the flag-OFF path really is the old app (no
// cursor poll, no display listeners, no widget geometry calls).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

const WIDGET_FILE = path.join('src', 'widget', 'widget.html');

/**
 * Boot main.cjs with an isolated HOME, an optional config file and an optional
 * KIMFLOW_FLOWBAR value. Returns the floating window (instance 1).
 *
 * @param {object} t node:test context
 * @param {{settings?: object, flowbar?: string}} [options]
 */
async function boot(t, { settings = null, flowbar } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-flag-matrix-'));
  const previousFlowBar = process.env.KIMFLOW_FLOWBAR;

  t.after(() => {
    if (previousFlowBar === undefined) delete process.env.KIMFLOW_FLOWBAR;
    else process.env.KIMFLOW_FLOWBAR = previousFlowBar;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  if (flowbar === undefined) delete process.env.KIMFLOW_FLOWBAR;
  else process.env.KIMFLOW_FLOWBAR = flowbar;

  const harness = await loadMain({ locale: 'en-US', home, settings });
  t.after(() => harness.restore());
  return { floating: harness.instances[1], harness };
}

/** @param {object} floating the floating BrowserWindow stub */
function isWidget(floating) {
  return typeof floating.loadedFile === 'string' && floating.loadedFile.endsWith(WIDGET_FILE);
}

/** @param {object} floating the floating BrowserWindow stub */
function isLegacyOverlay(floating) {
  return typeof floating.loadedFile === 'string' && floating.loadedFile.endsWith('overlay.html');
}

// ---------------------------------------------------------------------------
// The setting half of the matrix.
// ---------------------------------------------------------------------------

test('no stored key (a config written before this release) gets the widget', async (t) => {
  const { floating } = await boot(t);
  assert.ok(isWidget(floating), `expected the widget, got ${floating.loadedFile}`);
});

test('useFlowBarWidget: true gets the widget', async (t) => {
  const { floating } = await boot(t, { settings: { useFlowBarWidget: true } });
  assert.ok(isWidget(floating));
});

test('useFlowBarWidget: false gets the legacy overlay', async (t) => {
  const { floating } = await boot(t, { settings: { useFlowBarWidget: false } });
  assert.ok(isLegacyOverlay(floating), `expected overlay.html, got ${floating.loadedFile}`);
});

test('a non-boolean flag value is ignored, not coerced: only `false` rolls back', async (t) => {
  // 0 and '' are falsy in JS but must NOT disable the widget; the contract is
  // "an explicit boolean false", because the config file is hand-editable.
  for (const value of ['yes', 1, 0, null, '', [], {}, 'false']) {
    const { floating } = await boot(t, { settings: { useFlowBarWidget: value } });
    assert.ok(isWidget(floating), `useFlowBarWidget: ${JSON.stringify(value)} must not roll back`);
  }
});

// ---------------------------------------------------------------------------
// The environment half, and the two inputs disagreeing.
// ---------------------------------------------------------------------------

test('KIMFLOW_FLOWBAR=0 forces the legacy overlay even when the setting is true', async (t) => {
  const { floating } = await boot(t, { settings: { useFlowBarWidget: true }, flowbar: '0' });
  assert.ok(isLegacyOverlay(floating), `expected overlay.html, got ${floating.loadedFile}`);
});

test('KIMFLOW_FLOWBAR=0 forces the legacy overlay when no key is stored', async (t) => {
  const { floating } = await boot(t, { flowbar: '0' });
  assert.ok(isLegacyOverlay(floating));
});

test('KIMFLOW_FLOWBAR=1 does NOT override an explicit false', async (t) => {
  // The env var is a one-way escape hatch to the legacy UI; it must never
  // force the new UI back on against the user's stored choice.
  const { floating } = await boot(t, { settings: { useFlowBarWidget: false }, flowbar: '1' });
  assert.ok(isLegacyOverlay(floating), `expected overlay.html, got ${floating.loadedFile}`);
});

test('KIMFLOW_FLOWBAR=1 keeps the widget when the setting is true', async (t) => {
  const { floating } = await boot(t, { settings: { useFlowBarWidget: true }, flowbar: '1' });
  assert.ok(isWidget(floating));
});

test('a garbage KIMFLOW_FLOWBAR value changes nothing', async (t) => {
  for (const flowbar of ['yes', 'false', '00', ' ', 'no']) {
    const off = await boot(t, { settings: { useFlowBarWidget: false }, flowbar });
    assert.ok(isLegacyOverlay(off.floating), `KIMFLOW_FLOWBAR=${JSON.stringify(flowbar)} must not enable the widget`);

    const on = await boot(t, { settings: { useFlowBarWidget: true }, flowbar });
    assert.ok(isWidget(on.floating), `KIMFLOW_FLOWBAR=${JSON.stringify(flowbar)} must not disable the widget`);
  }
});

// ---------------------------------------------------------------------------
// The flag-OFF path must be the old app: none of the widget-only machinery may
// run.
// ---------------------------------------------------------------------------

test('with the flag off, no display listener is registered and no widget geometry call is made', async (t) => {
  const { floating, harness } = await boot(t, { settings: { useFlowBarWidget: false } });

  assert.ok(isLegacyOverlay(floating));
  assert.equal(harness.screen._listeners.size, 0, 'the widget registered screen listeners while disabled');
  assert.deepEqual(floating.boundsCalls, [], 'the widget repositioned the legacy overlay');
  // The legacy path's single, pre-existing call: the overlay owns its controls.
  assert.deepEqual(floating.ignoreMouseEvents, [{ ignore: false, opts: undefined }]);
  assert.equal(floating.alwaysOnTop, null, 'widget-only always-on-top levels must not be applied to the overlay');
  assert.equal(floating.visibleOnAllWorkspaces, null);
  assert.equal(floating.options.width, 1, 'the legacy overlay options must come from buildOverlayWindowOptions');
});

test('with the flag on, the widget does register its display listeners and place itself', async (t) => {
  const { floating, harness } = await boot(t);

  assert.ok(isWidget(floating));
  assert.deepEqual(
    [...harness.screen._listeners.keys()].sort(),
    ['display-added', 'display-metrics-changed', 'display-removed'],
  );
  assert.equal(floating.boundsCalls.length, 1, 'the widget must place itself once after load');
  assert.equal(floating.ignoreMouseEvents[0].ignore, true, 'click-through starts on');
  assert.deepEqual(floating.alwaysOnTop, { value: true, level: 'screen-saver' });
  assert.equal(floating.visibleOnAllWorkspaces.value, true);
});
