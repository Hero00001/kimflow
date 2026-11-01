// test/widget-teardown.test.cjs
//
// Teardown is where floating-window code leaks: a 16ms interval that keeps the
// process alive, or `screen.on` handlers that stack up every time the window is
// recreated. `destroyOverlayWindow()` in main.cjs now also calls
// `destroyWidgetWindow()`, including on the flag-OFF path where no widget was
// ever created, so double-destroy has to be safe too.
const test = require('node:test');
const assert = require('node:assert');

const {
  WIN_W,
  WIN_H,
  createWidgetWindow,
  destroyWidgetWindow,
  getWidgetWindow,
} = require('../backend/widget-window.cjs');

/** A screen stub that keeps per-event handler sets, so duplicates are visible. */
function trackingScreen(workArea = { x: 0, y: 0, width: 1920, height: 1080 }) {
  const active = new Map();
  const registrations = [];
  return {
    registrations,
    on(event, handler) {
      registrations.push({ event, handler });
      if (!active.has(event)) active.set(event, new Set());
      active.get(event).add(handler);
    },
    off(event, handler) { const set = active.get(event); if (set) set.delete(handler); },
    removeListener(event, handler) { const set = active.get(event); if (set) set.delete(handler); },
    activeCount() {
      let total = 0;
      for (const set of active.values()) total += set.size;
      return total;
    },
    activeEvents() { return [...active.keys()].filter((event) => active.get(event).size > 0).sort(); },
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getPrimaryDisplay: () => ({ workArea: { ...workArea } }),
    getDisplayNearestPoint: () => ({ workArea: { ...workArea } }),
  };
}

function fakeBrowserWindow() {
  const created = [];
  class FakeWindow {
    constructor(options) {
      this.options = options || {};
      this.loadedFile = null;
      this.destroyed = false;
      this.destroyCalls = 0;
      this._visible = false;
      this.bounds = null;
      this.getBoundsCalls = 0;
      this.ignoreMouseCalls = [];
      created.push(this);
    }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    showInactive() { this._visible = true; }
    isVisible() { return this._visible; }
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { this.getBoundsCalls += 1; return this.bounds || { x: 0, y: 0, width: WIN_W, height: WIN_H }; }
    setIgnoreMouseEvents(ignore) { this.ignoreMouseCalls.push(ignore); }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    on() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.destroyCalls += 1; this._visible = false; }
  }
  return { FakeWindow, created };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('destroyWidgetWindow() is safe before anything was ever created', () => {
  // This is exactly what happens on the flag-OFF path: main.cjs's
  // destroyOverlayWindow() always calls it, even for a legacy-only session.
  assert.doesNotThrow(() => destroyWidgetWindow());
  assert.equal(getWidgetWindow(), null);
  assert.doesNotThrow(() => destroyWidgetWindow());
});

test('double destroy does not throw and does not destroy twice', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindow();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen: trackingScreen(), getState: () => 'recording' });
  t.after(() => destroyWidgetWindow());
  await flush();

  const win = created[0];
  destroyWidgetWindow();
  assert.equal(win.destroyed, true);
  assert.equal(win.destroyCalls, 1);

  assert.doesNotThrow(() => destroyWidgetWindow());
  assert.equal(win.destroyCalls, 1, 'the second teardown must not call destroy() again');
  assert.equal(getWidgetWindow(), null);
});

test('recreating the window does not stack screen listeners', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindow();
  const screen = trackingScreen();
  t.after(() => destroyWidgetWindow());

  createWidgetWindow({ BrowserWindow: FakeWindow, screen, getState: () => 'recording' });
  await flush();
  assert.equal(screen.activeCount(), 3);
  assert.deepEqual(screen.activeEvents(), ['display-added', 'display-metrics-changed', 'display-removed']);

  // Recreate (e.g. after a display hot-plug recovery or an app relaunch path).
  createWidgetWindow({ BrowserWindow: FakeWindow, screen, getState: () => 'recording' });
  await flush();
  assert.equal(screen.activeCount(), 3, 'the old handlers must be removed before the new ones are added');
  assert.equal(created.length, 2);
  assert.equal(created[0].destroyed, true, 'the replaced window must be destroyed');
  assert.equal(getWidgetWindow(), created[1]);
});

test('destroying the window removes every screen listener', async (t) => {
  const { FakeWindow } = fakeBrowserWindow();
  const screen = trackingScreen();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen, getState: () => 'recording' });
  await flush();
  assert.equal(screen.activeCount(), 3);

  destroyWidgetWindow();
  assert.equal(screen.activeCount(), 0, 'a leaked screen.on handler would keep repositioning a dead window');
  assert.deepEqual(screen.activeEvents(), []);
});

test('the cursor poll interval is unref-ed and cleared on destroy', async (t) => {
  const { FakeWindow } = fakeBrowserWindow();
  const screen = trackingScreen();
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const timers = [];
  const cleared = [];

  global.setInterval = (fn, ms) => {
    const handle = { fn, ms, unrefCalled: false, unref() { this.unrefCalled = true; return this; } };
    timers.push(handle);
    return handle;
  };
  global.clearInterval = (handle) => { cleared.push(handle); };
  t.after(() => destroyWidgetWindow());

  try {
    createWidgetWindow({ BrowserWindow: FakeWindow, screen, getState: () => 'recording' });
    await flush();

    assert.equal(timers.length, 1, 'exactly one poll interval must be created');
    assert.equal(timers[0].ms, 16, 'the poll runs once per frame');
    assert.equal(timers[0].unrefCalled, true, 'the interval must be unref-ed or it keeps the process alive');

    // Still inside the patch: teardown must hand the same handle to clearInterval.
    assert.doesNotThrow(() => destroyWidgetWindow());
    assert.deepEqual(cleared, [timers[0]], 'destroy must clear the poll interval');
  } finally {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
});

test('the poll really stops after teardown', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindow();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen: trackingScreen(), getState: () => 'recording' });
  t.after(() => destroyWidgetWindow());
  await flush();

  const win = created[0];
  // Let the poll run at least once so we know it was live.
  await wait(50);
  assert.ok(win.getBoundsCalls > 0, 'the poll should have hit-tested the cursor');

  destroyWidgetWindow();
  const callsAtTeardown = win.getBoundsCalls;
  await wait(60);
  assert.equal(win.getBoundsCalls, callsAtTeardown, 'the poll kept running after the window was destroyed');
});

test('a window destroyed out from under the poll stops the timer', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindow();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen: trackingScreen(), getState: () => 'recording' });
  t.after(() => destroyWidgetWindow());
  await flush();

  // Simulate the OS/Electron closing the window without going through
  // destroyWidgetWindow(): the next tick must notice and stop polling.
  created[0].destroyed = true;
  const before = created[0].getBoundsCalls;
  await wait(60);
  assert.equal(created[0].getBoundsCalls, before, 'the poll must stop once the window reports isDestroyed()');
});
