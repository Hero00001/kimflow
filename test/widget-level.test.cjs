// test/widget-level.test.cjs
//
// The `mic-level` channel feeds the flow-bar widget's audio-reactive bars. It
// is a one-way channel, so it must never throw at the sender: untrusted
// senders and malformed payloads are dropped silently, out-of-range values are
// clamped, and nothing is forwarded unless a recording is actually running.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

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

/** Boot main.cjs with the recorder pinned to `state`. */
async function boot(t, state) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-widget-level-'));
  t.after(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  const harness = await loadMain({
    locale: 'en-US',
    home,
    overrides: { 'recorder.cjs': recorderStub(state) },
  });
  t.after(() => harness.restore());
  return {
    handler: harness.listeners.get('mic-level'),
    mainWindow: harness.instances[0],
    widget: harness.instances[1],
  };
}

function forwarded(widget) {
  return widget.webContents.sent.filter((message) => message.channel === 'widget-level');
}

test('mic-level is registered as a one-way channel', async (t) => {
  const { handler } = await boot(t, 'recording');
  assert.equal(typeof handler, 'function');
});

test('a trusted sender while recording is forwarded to the widget', async (t) => {
  const { handler, mainWindow, widget } = await boot(t, 'recording');
  handler({ sender: { id: mainWindow.webContents.id } }, 0.4);
  assert.deepEqual(forwarded(widget), [{ channel: 'widget-level', value: 0.4 }]);
});

test('the widget window itself is a trusted sender too', async (t) => {
  const { handler, widget } = await boot(t, 'recording');
  handler({ sender: { id: widget.webContents.id } }, 0.2);
  assert.deepEqual(forwarded(widget), [{ channel: 'widget-level', value: 0.2 }]);
});

test('untrusted senders are ignored without throwing', async (t) => {
  const { handler, widget } = await boot(t, 'recording');
  assert.doesNotThrow(() => handler({ sender: { id: 999999 } }, 0.5));
  assert.doesNotThrow(() => handler({}, 0.5));
  assert.doesNotThrow(() => handler(null, 0.5));
  assert.deepEqual(forwarded(widget), []);
});

test('non-finite and non-numeric payloads are dropped', async (t) => {
  const { handler, mainWindow, widget } = await boot(t, 'recording');
  const event = { sender: { id: mainWindow.webContents.id } };
  for (const value of [NaN, Infinity, -Infinity, '0.5', null, undefined, {}, [], true]) {
    handler(event, value);
  }
  assert.deepEqual(forwarded(widget), []);
});

test('out-of-range levels are clamped', async (t) => {
  const { handler, mainWindow, widget } = await boot(t, 'recording');
  const event = { sender: { id: mainWindow.webContents.id } };
  handler(event, 5);
  handler(event, -5);
  handler(event, 0.25);
  assert.deepEqual(forwarded(widget).map((message) => message.value), [1, 0, 0.25]);
});

test('nothing is forwarded when no recording is running', async (t) => {
  for (const state of ['ready', 'paused', 'transcribing']) {
    const { handler, mainWindow, widget } = await boot(t, state);
    handler({ sender: { id: mainWindow.webContents.id } }, 0.5);
    assert.deepEqual(forwarded(widget), [], `state ${state} must not forward`);
  }
});

test('a destroyed widget window does not break the channel', async (t) => {
  const { handler, mainWindow, widget } = await boot(t, 'recording');
  widget.destroy();
  assert.doesNotThrow(() => handler({ sender: { id: mainWindow.webContents.id } }, 0.5));
});
