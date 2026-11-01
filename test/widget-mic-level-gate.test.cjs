// test/widget-mic-level-gate.test.cjs
//
// Regression tests for F1: `mic-level` used to be forwarded whenever a trusted
// sender sent a finite number while the recorder was RECORDING, without asking
// whether the flow-bar widget was the window that actually exists.
//
// Reachable path: KIMFLOW_FLOWBAR=0 with a stored `useFlowBarWidget` of true or
// absent. main.cjs created the legacy overlay, but the renderer's gate
// (src/audio/recorder.ts) reads the *stored* setting and kept sending levels at
// ~30 Hz, so main forwarded `widget-level` to a renderer with no listener.
//
// The fix makes `createWindows()` assign one module-level `flowBarEnabled` and
// uses that same value both to choose the window and to gate the channel, so
// the two cannot disagree. The invariant below is exactly that.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

const WIDGET_FILE = path.join('src', 'widget', 'widget.html');

function recorderStub(state) {
  return {
    startRecording: async () => {},
    stopRecording: async () => ({ aborted: true }),
    pauseRecording: async () => {},
    resumeRecording: async () => {},
    cancelRecording: async () => {},
    getState: () => state,
    STATE: { READY: 'ready', RECORDING: 'recording', PAUSED: 'paused', TRANSCRIBING: 'transcribing' },
  };
}

/**
 * Boot main.cjs with the recorder pinned to `state`, an isolated HOME, an
 * optional config file and an optional KIMFLOW_FLOWBAR value.
 *
 * @param {object} t node:test context
 * @param {{settings?: object, flowbar?: string, state?: string}} [options]
 */
async function boot(t, { settings = null, flowbar, state = 'recording' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-mic-gate-'));
  const previousFlowBar = process.env.KIMFLOW_FLOWBAR;

  t.after(() => {
    if (previousFlowBar === undefined) delete process.env.KIMFLOW_FLOWBAR;
    else process.env.KIMFLOW_FLOWBAR = previousFlowBar;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  if (flowbar === undefined) delete process.env.KIMFLOW_FLOWBAR;
  else process.env.KIMFLOW_FLOWBAR = flowbar;

  const harness = await loadMain({
    locale: 'en-US',
    home,
    settings,
    overrides: { 'recorder.cjs': recorderStub(state) },
  });
  t.after(() => harness.restore());

  return {
    handler: harness.listeners.get('mic-level'),
    mainWindow: harness.instances[0],
    floating: harness.instances[1],
    harness,
  };
}

/** @param {object} floating */
function createdWidget(floating) {
  return typeof floating.loadedFile === 'string' && floating.loadedFile.endsWith(WIDGET_FILE);
}

/** @param {object} floating */
function forwardedLevels(floating) {
  return floating.webContents.sent.filter((message) => message.channel === 'widget-level');
}

/** Send one valid level from the trusted main window. */
function sendLevel({ handler, mainWindow }, value = 0.5) {
  handler({ sender: { id: mainWindow.webContents.id } }, value);
}

test('flag off in config: the legacy overlay exists and nothing is forwarded', async (t) => {
  const ctx = await boot(t, { settings: { useFlowBarWidget: false } });
  assert.ok(!createdWidget(ctx.floating), 'expected the legacy overlay');
  assert.ok(ctx.floating.loadedFile.endsWith('overlay.html'), `got ${ctx.floating.loadedFile}`);

  sendLevel(ctx);
  assert.deepEqual(forwardedLevels(ctx.floating), [], 'the legacy overlay must not receive widget-level');
});

test('KIMFLOW_FLOWBAR=0 with the stored flag on: the legacy overlay exists and nothing is forwarded', async (t) => {
  // This is the exact F1 scenario: the renderer still believes the widget is
  // on (it reads the stored setting) and keeps sending mic-level.
  const ctx = await boot(t, { settings: { useFlowBarWidget: true }, flowbar: '0' });
  assert.ok(!createdWidget(ctx.floating), 'expected the legacy overlay');
  assert.ok(ctx.floating.loadedFile.endsWith('overlay.html'), `got ${ctx.floating.loadedFile}`);

  sendLevel(ctx);
  assert.deepEqual(forwardedLevels(ctx.floating), []);
});

test('KIMFLOW_FLOWBAR=0 with no stored key: the legacy overlay exists and nothing is forwarded', async (t) => {
  const ctx = await boot(t, { flowbar: '0' });
  assert.ok(!createdWidget(ctx.floating));
  sendLevel(ctx);
  assert.deepEqual(forwardedLevels(ctx.floating), []);
});

test('flag on: the widget exists and exactly one level is forwarded', async (t) => {
  const ctx = await boot(t, {});
  assert.ok(createdWidget(ctx.floating), `expected the widget, got ${ctx.floating.loadedFile}`);

  sendLevel(ctx, 0.4);
  assert.deepEqual(forwardedLevels(ctx.floating), [{ channel: 'widget-level', value: 0.4 }]);
});

test('flag on via the env var: still forwards', async (t) => {
  const ctx = await boot(t, { settings: { useFlowBarWidget: true }, flowbar: '1' });
  assert.ok(createdWidget(ctx.floating));
  sendLevel(ctx);
  assert.equal(forwardedLevels(ctx.floating).length, 1);
});

test('the window that exists and the gate that forwards can never disagree', async (t) => {
  // The invariant the fix exists to protect. A future edit that reintroduced a
  // second `loadSettings()` call (or read the flag at message time) would break
  // this for at least one of the four combinations.
  const matrix = [
    { settings: null, flowbar: undefined },
    { settings: { useFlowBarWidget: true }, flowbar: undefined },
    { settings: { useFlowBarWidget: false }, flowbar: undefined },
    { settings: null, flowbar: '0' },
    { settings: { useFlowBarWidget: true }, flowbar: '0' },
    { settings: { useFlowBarWidget: false }, flowbar: '0' },
    { settings: { useFlowBarWidget: false }, flowbar: '1' },
  ];

  for (const options of matrix) {
    const ctx = await boot(t, options);
    const label = `settings=${JSON.stringify(options.settings)} env=${String(options.flowbar)}`;
    const isWidget = createdWidget(ctx.floating);

    sendLevel(ctx);
    const forwarded = forwardedLevels(ctx.floating).length;

    assert.equal(
      forwarded > 0,
      isWidget,
      `${label}: window is ${isWidget ? 'the widget' : 'the legacy overlay'} but forwarded=${forwarded}`,
    );
  }
});

test('with the flag off the gate is checked before the sender, so nothing throws', async (t) => {
  const ctx = await boot(t, { settings: { useFlowBarWidget: false } });
  assert.doesNotThrow(() => ctx.handler({}, 0.5));
  assert.doesNotThrow(() => ctx.handler({ sender: { id: 999999 } }, 0.5));
  assert.deepEqual(forwardedLevels(ctx.floating), []);
});

test('with the flag off, no level is forwarded for any recorder state', async (t) => {
  for (const state of ['ready', 'recording', 'paused', 'transcribing']) {
    const ctx = await boot(t, { settings: { useFlowBarWidget: false }, state });
    sendLevel(ctx);
    assert.deepEqual(forwardedLevels(ctx.floating), [], `state ${state} must not forward`);
  }
});
