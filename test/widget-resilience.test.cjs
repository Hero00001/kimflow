'use strict';
// Widget resilience: off-screen rescue and renderer-crash recovery.
//
// The user reported the capsule "disappearing" when switching applications.
// Two recovery paths cover the plausible mechanisms:
//   1. a crashed renderer leaves the transparent window alive but blank —
//      indistinguishable from a vanished widget — so `render-process-gone`
//      must reload the page (capped, so a real bug cannot spin forever);
//   2. the window itself can end up fully outside every display (a transient
//      work area during a display change, or an accidental drag off-screen),
//      so the poll re-anchors it — but only when it is truly unreachable,
//      never snapping back a capsule the user deliberately placed.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const {
  WIN_W,
  WIN_H,
  BOTTOM_MARGIN,
  rectIntersectsAnyDisplay,
  ensureOnScreen,
  createWidgetWindow,
  destroyWidgetWindow,
  getWidgetWindow,
} = require('../backend/widget-window.cjs');

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function fakeScreen(workArea) {
  const area = workArea || { ...WORK_AREA };
  const listeners = new Map();
  return {
    _cursor: { x: 0, y: 0 },
    getPrimaryDisplay: () => ({ workArea: { ...area } }),
    getDisplayNearestPoint: () => ({ workArea: { ...area } }),
    getCursorScreenPoint() { return { ...this._cursor }; },
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
        id: 42,
        listeners: new Map(),
        on(event, handler) { this.listeners.set(event, handler); },
        reloadCalls: 0,
        reload() { this.reloadCalls += 1; },
      };
      this.loadedFile = null;
      this.shownInactive = false;
      this.destroyed = false;
      this._visible = false;
      this.ignoreMouseCalls = [];
      this.bounds = null;
      created.push(this);
    }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    showInactive() { this.shownInactive = true; this._visible = true; }
    isVisible() { return this._visible; }
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds || { x: 0, y: 0, width: WIN_W, height: WIN_H }; }
    setIgnoreMouseEvents(ignore, opts) { this.ignoreMouseCalls.push({ ignore, opts }); }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    on() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this._visible = false; }
  }
  return { FakeWindow, created };
}

test('rectIntersectsAnyDisplay: true while the window overlaps a work area', () => {
  const bounds = { x: 830, y: WIN_H + BOTTOM_MARGIN, width: WIN_W, height: WIN_H };
  assert.equal(rectIntersectsAnyDisplay(bounds, [{ workArea: WORK_AREA }]), true);
});

test('rectIntersectsAnyDisplay: false when fully outside every display', () => {
  const bounds = { x: 99999, y: 99999, width: WIN_W, height: WIN_H };
  assert.equal(rectIntersectsAnyDisplay(bounds, [{ workArea: WORK_AREA }]), false);
});

test('rectIntersectsAnyDisplay: false for a window entirely past the right edge', () => {
  const bounds = { x: WORK_AREA.width + 1, y: 100, width: WIN_W, height: WIN_H };
  assert.equal(rectIntersectsAnyDisplay(bounds, [{ workArea: WORK_AREA }]), false);
});

test('rectIntersectsAnyDisplay: true across a negative-origin (left-hand) monitor', () => {
  const left = { x: -1920, y: 0, width: 1920, height: 1040 };
  const bounds = { x: -1000, y: 500, width: WIN_W, height: WIN_H };
  assert.equal(rectIntersectsAnyDisplay(bounds, [{ workArea: left }]), true);
});

test('rectIntersectsAnyDisplay: an unusable display list counts as on-screen', () => {
  const bounds = { x: 99999, y: 99999, width: WIN_W, height: WIN_H };
  // If `screen` cannot tell us where displays are, the rescue must not
  // fling the window somewhere based on a guess.
  assert.equal(rectIntersectsAnyDisplay(bounds, null), true);
  assert.equal(rectIntersectsAnyDisplay(bounds, []), true);
  assert.equal(rectIntersectsAnyDisplay(bounds, [{}]), true);
});

test('rectIntersectsAnyDisplay: rejects malformed bounds', () => {
  assert.equal(rectIntersectsAnyDisplay(null, [{ workArea: WORK_AREA }]), false);
  assert.equal(rectIntersectsAnyDisplay({ x: NaN, y: 0, width: 10, height: 10 }, [{ workArea: WORK_AREA }]), false);
});

test('a display change does not move a window that is still on-screen', async () => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs' });
  const win = created[0];
  // Let the loadFile promise's microtask run so the window is positioned
  // before we snapshot its bounds.
  await new Promise(setImmediate);
  const initial = { ...win.bounds };
  assert.ok(initial, 'window is positioned after the (resolved) load');

  screen.emit('display-metrics-changed');
  assert.deepEqual(win.bounds, initial, 'a user-placed visible capsule is not snapped back');
  destroyWidgetWindow();
});

test('a window fully off-screen is rescued back into the work area', () => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs' });
  const win = created[0];

  // Simulate the widget ending up unreachable (transient work area, bad
  // display event, or an accidental drag off-screen).
  win.bounds = { x: 99999, y: 99999, width: WIN_W, height: WIN_H };
  ensureOnScreen();

  assert.ok(win.bounds, 'bounds were re-applied');
  assert.ok(win.bounds.x >= WORK_AREA.x, 'rescued x is inside the work area');
  assert.ok(
    win.bounds.x + win.bounds.width <= WORK_AREA.x + WORK_AREA.width,
    'rescued window fits the work area width',
  );
  assert.equal(win.bounds.y, WORK_AREA.y + WORK_AREA.height - WIN_H - BOTTOM_MARGIN);
  destroyWidgetWindow();
});

test('the display-event handler performs the rescue (integration through createWidgetWindow)', () => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  createWidgetWindow({ BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs' });
  const win = created[0];
  win.bounds = { x: 99999, y: 99999, width: WIN_W, height: WIN_H };
  screen.emit('display-removed');
  assert.ok(win.bounds.x < WORK_AREA.width, 'display event triggers the off-screen rescue');
  destroyWidgetWindow();
});

test('a crashed widget renderer is reloaded, then the window is recreated', () => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const seenByOwner = [];
  createWidgetWindow({
    BrowserWindow: FakeWindow, screen, preloadPath: 'preload.cjs',
    onCreated: (win) => seenByOwner.push(win),
  });
  const win = created[0];
  const handler = win.webContents.listeners.get('render-process-gone');
  assert.equal(typeof handler, 'function', 'render-process-gone is wired');

  handler(); handler(); handler();
  assert.equal(win.webContents.reloadCalls, 3, 'the first three crashes each trigger a reload');
  handler();
  // The old contract stopped here, leaving an invisible blank window — the
  // exact "widget randomly disappeared" report. Recovery now recreates the
  // window from the original options.
  assert.equal(win.destroyed, true, 'the dead window is destroyed');
  assert.equal(created.length, 2, 'a fresh widget window is created');
  assert.ok(getWidgetWindow() === created[1], 'the module tracks the fresh window');
  assert.ok(seenByOwner.includes(created[1]), 'the owner re-points its reference at the fresh window');

  // The fresh window recovers on its own terms; within the recreate cool-down
  // a further crash loop cannot spin up endless windows.
  const freshHandler = created[1].webContents.listeners.get('render-process-gone');
  freshHandler(); freshHandler(); freshHandler();
  assert.equal(created[1].webContents.reloadCalls, 3, 'the fresh window reloads again');
  freshHandler();
  assert.equal(created.length, 2, 'the recreate cool-down prevents a crash loop');
  destroyWidgetWindow();
});
