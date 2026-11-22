'use strict';
// test/widget-watchdog.test.cjs
//
// The watchdog is the self-healing safety net for the widget's click-through
// system. The user reported the capsule going completely "stale": not
// draggable, not clickable, and no longer on top. Root causes addressed here:
//   - the 16 ms cursor poll can die (hide event, power suspend, a resume that
//     gave up on an invisible window) and nothing re-armed it, leaving
//     setIgnoreMouseEvents(true) stuck forever;
//   - alwaysOnTop was asserted exactly once at creation; Windows demotes
//     topmost transparent windows after sleep/wake and display changes.
//
// The watchdog re-derives the hit test at 1 Hz, restarts a dead poll,
// re-applies the ignore state (failing OPEN when it cannot be computed), and
// periodically re-asserts topmost.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WIN_W,
  WIN_H,
  CAPSULE_SIZES,
  computeWidgetBounds,
  createWidgetWindow,
  destroyWidgetWindow,
  getWidgetWindow,
  suspendWidgetPoll,
  resumeWidgetPoll,
  watchdogTick,
  assertAlwaysOnTop,
} = require('../backend/widget-window.cjs');

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function fakeScreen(workArea) {
  const area = workArea || { ...WORK_AREA };
  const listeners = new Map();
  return {
    _cursor: { x: 0, y: 0 },
    _throwOnCursor: false,
    getPrimaryDisplay: () => ({ workArea: { ...area } }),
    getDisplayNearestPoint: () => ({ workArea: { ...area } }),
    getCursorScreenPoint() {
      if (this._throwOnCursor) throw new Error('screen API wedged');
      return { ...this._cursor };
    },
    getAllDisplays: () => [{ workArea: { ...area } }],
    on(event, handler) { listeners.set(event, handler); },
    off(event, handler) { if (listeners.get(event) === handler) listeners.delete(event); },
    removeListener(event, handler) { if (listeners.get(event) === handler) listeners.delete(event); },
    emit(event) { const handler = listeners.get(event); if (handler) handler(); },
  };
}

function fakeBrowserWindowFactory() {
  const created = [];
  class FakeWindow {
    constructor(options) {
      this.options = options || {};
      this.webContents = {
        id: 9,
        listeners: new Map(),
        on(event, handler) { this.listeners.set(event, handler); },
        setWindowOpenHandler() { return () => {}; },
        send() {},
        isDestroyed: () => false,
      };
      this.destroyed = false;
      this._visible = false;
      this.ignoreMouseCalls = [];
      this.alwaysOnTopCalls = [];
      this.alwaysOnTopNow = false;
      this.bounds = null;
      this.getBoundsCalls = 0;
      created.push(this);
    }
    loadFile() { return Promise.resolve(); }
    showInactive() { this._visible = true; }
    isVisible() { return this._visible; }
    setBounds(b) { this.bounds = b; }
    getBounds() {
      this.getBoundsCalls += 1;
      return this.bounds || { x: 0, y: 0, width: WIN_W, height: WIN_H };
    }
    setIgnoreMouseEvents(ignore, opts) { this.ignoreMouseCalls.push({ ignore, opts }); }
    setAlwaysOnTop(value, level) {
      this.alwaysOnTopCalls.push({ value, level });
      this.alwaysOnTopNow = value;
    }
    isAlwaysOnTop() { return this.alwaysOnTopNow; }
    setVisibleOnAllWorkspaces() {}
    on(event, handler) {
      this.winListeners = this.winListeners || new Map();
      this.winListeners.set(event, handler);
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this._visible = false; }
  }
  return { FakeWindow, created };
}

/** Cursor point for the centre of the capsule of `state`, in screen space. */
function cursorInsideCapsule(state) {
  const size = CAPSULE_SIZES[state] || CAPSULE_SIZES.idle;
  const origin = computeWidgetBounds(WORK_AREA); // where createWidgetWindow parks the window
  return { x: origin.x + WIN_W / 2, y: origin.y + WIN_H - size.h / 2 };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the watchdog re-applies the ignore state the poll left stuck (stale fix)', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs', getState: () => 'recording',
  });
  t.after(() => destroyWidgetWindow());
  await flush();

  // Let the live poll park the state: cursor far away → click-through.
  screen._cursor = { x: 5, y: 5 };
  await wait(80);
  assert.equal(win.ignoreMouseCalls.at(-1).ignore, true, 'sanity: cursor far → ignoring');

  // Now the cursor sits on the capsule, but the poll is dead (simulate the
  // stale state directly by calling only the watchdog — the poll's hysteresis
  // never gets a say). The watchdog must un-stick the window within one tick.
  screen._cursor = cursorInsideCapsule('listening');
  watchdogTick();
  assert.equal(
    win.ignoreMouseCalls.at(-1).ignore,
    false,
    'the watchdog re-derived the hit test and allowed mouse events again',
  );
});

test('the watchdog restarts a dead poll and keeps the ignore state correct', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs', getState: () => 'recording',
  });
  t.after(() => destroyWidgetWindow());
  await flush();
  await wait(80);
  const callsBefore = win.getBoundsCalls;

  // 'hide' stops the poll; then the window becomes visible again WITHOUT a
  // 'show' event ever firing (the exact resume gap that made widgets stale).
  const hideHandler = win.winListeners.get('hide');
  assert.equal(typeof hideHandler, 'function', 'sanity: the hide handler is wired');
  hideHandler();
  win._visible = true;

  watchdogTick();
  // The watchdog restarted the poll: within a couple of frames the poll is
  // hit-testing again (getBounds is only ever called by poll/watchdog).
  await wait(80);
  assert.ok(
    win.getBoundsCalls > callsBefore,
    'the poll was re-armed by the watchdog and is hit-testing again',
  );

  // And the restarted poll actually applies states: cursor far → click-through.
  screen._cursor = { x: 5, y: 5 };
  await wait(80);
  assert.equal(win.ignoreMouseCalls.at(-1).ignore, true, 'the restarted poll enforces click-through');
});

test('the watchdog fails OPEN when the hit test cannot be computed', async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  screen._throwOnCursor = true; // "cannot tell where the cursor is"
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs', getState: () => 'recording',
  });
  t.after(() => destroyWidgetWindow());
  await flush();
  // Creation applies click-through; the broken screen API then leaves the
  // hit test unanswerable forever.
  assert.equal(win.ignoreMouseCalls[0].ignore, true, 'sanity: creation is click-through');

  win._visible = true;
  watchdogTick();
  assert.equal(
    win.ignoreMouseCalls.at(-1).ignore,
    false,
    'an unanswerable hit test must fail OPEN (allow mouse), never stay stuck click-through',
  );
});

test('assertAlwaysOnTop re-asserts topmost when the OS dropped it', async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs',
  });
  t.after(() => destroyWidgetWindow());
  await flush();

  win.alwaysOnTopNow = false; // Windows demoted the window (sleep, display change)
  const calls = win.alwaysOnTopCalls.length;
  const result = assertAlwaysOnTop();
  assert.equal(result, true, 'the window is topmost again after the call');
  assert.equal(win.alwaysOnTopCalls.length, calls + 1, 'setAlwaysOnTop was re-applied');
  assert.deepEqual(win.alwaysOnTopCalls.at(-1), { value: true, level: 'screen-saver' });

  // Already-topmost windows are not touched (no churn).
  win.alwaysOnTopNow = true;
  const calls2 = win.alwaysOnTopCalls.length;
  assert.equal(assertAlwaysOnTop(), true);
  assert.equal(win.alwaysOnTopCalls.length, calls2, 'a still-topmost window is left alone');
});

test('the watchdog periodically re-asserts topmost without a visible trigger', async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs', getState: () => 'recording',
  });
  t.after(() => destroyWidgetWindow());
  await flush();
  win._visible = true;

  // Ten ticks = one periodic hygiene pass (WATCHDOG_TOPMOST_EVERY). Drop the
  // topmost rank mid-way; the hygiene pass must restore it.
  for (let i = 0; i < 9; i += 1) watchdogTick();
  win.alwaysOnTopNow = false;
  watchdogTick();
  assert.equal(win.alwaysOnTopNow, true, 'the periodic pass restored the topmost rank');
});

test('resumeWidgetPoll re-arms the poll even when the window is hidden at that instant', async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs', getState: () => 'recording',
  });
  t.after(() => destroyWidgetWindow());
  await flush();
  await wait(80);
  const boundsBefore = win.getBoundsCalls;

  suspendWidgetPoll(); // stops the poll, forces click-through
  assert.equal(win.ignoreMouseCalls.at(-1).ignore, true, 'suspend forces click-through');

  // Window hidden at the resume instant (the old code gave up here and the
  // poll stayed dead forever).
  win._visible = false;
  resumeWidgetPoll();

  win._visible = true; // shown again later, without a 'show' event
  await wait(80);
  assert.ok(
    win.getBoundsCalls > boundsBefore,
    'the poll was re-armed on resume and hit-tests once the window is visible',
  );
  screen._cursor = cursorInsideCapsule('listening');
  await wait(80);
  assert.equal(win.ignoreMouseCalls.at(-1).ignore, false, 'the re-armed poll allows mouse over the capsule');
});

test('display events re-assert topmost alongside the off-screen rescue', async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs',
  });
  t.after(() => destroyWidgetWindow());
  await flush();

  win.alwaysOnTopNow = false;
  const calls = win.alwaysOnTopCalls.length;
  screen.emit('display-metrics-changed');
  assert.equal(win.alwaysOnTopNow, true, 'a display event restored the topmost rank');
  assert.equal(win.alwaysOnTopCalls.length, calls + 1);
});

test('the watchdog stands down when the window dies (no orphan timers)', async () => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs', getState: () => 'recording',
  });
  await flush();
  created[0].destroyed = true; // OS closed it without destroyWidgetWindow()
  assert.doesNotThrow(() => watchdogTick(), 'a dead window must not throw in the watchdog');
  destroyWidgetWindow();
  assert.equal(getWidgetWindow(), null);
});
