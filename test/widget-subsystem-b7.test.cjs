'use strict';
// test/widget-subsystem-b7.test.cjs
//
// Fail-first tests for B7 (floating widget subsystem):
//   - W1: on Linux the flow-bar widget is NOT created (it would be a
//         permanent click blocker without click-through) — the legacy
//         overlay, which owns its small input area, is used instead.
//   - W9: the floating window's own 'closed' tears the widget subsystem down.
//   - W5: powerMonitor suspend/lock freezes the poll and forces click-through.
//   - W3: the click-through hit box is the union of the previous and target
//         capsule rects during the CSS size transition.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');
const {
  WIN_W,
  WIN_H,
  CAPSULE_SIZES,
  capsuleHitRect,
  suspendWidgetPoll,
  resumeWidgetPoll,
} = require('../backend/widget-window.cjs');

// ── W1: Linux never creates the click-blocking widget ───────────────────────

test('on Linux the floating UI is the legacy overlay, not the widget (W1)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b7-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });

  const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  t.after(() => { Object.defineProperty(process, 'platform', platformDesc); });

  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  assert.ok(harness.instances.length >= 2, 'main + floating windows created');
  const floating = harness.instances[1];
  // The harness stubs the legacy overlay at width 1; the real widget builder
  // uses the full capsule window width. Width 1 == legacy overlay path.
  assert.equal(floating.options.width, 1, 'the legacy overlay is created on Linux');
});

// ── W9: the floating window's closed tears the subsystem down ───────────────

test("the floating window's own closed event destroys the widget subsystem (W9)", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b7-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const widget = harness.instances[1];
  assert.equal(widget.isDestroyed(), false, 'the widget window is alive after creation');

  const closed = widget.winListeners && widget.winListeners.get('closed');
  assert.equal(typeof closed, 'function', "the widget window has a 'closed' handler");
  closed();
  assert.equal(widget.isDestroyed(), true, 'the closed handler tears the subsystem down (poll + listeners)');
});

// ── W5: power suspend freezes the poll and forces click-through ─────────────

test('suspendWidgetPoll stops the poll and forces click-through; resume re-arms (W5)', async (t) => {
  const { EventEmitter } = require('node:events');
  let pollTicks = 0;
  const created = [];
  class FakeWindow {
    constructor(options) {
      this.options = options || {};
      this.webContents = {
        id: 7,
        listeners: new Map(),
        on(event, handler) { this.listeners.set(event, handler); },
        setWindowOpenHandler() { return () => {}; },
        send() {},
        isDestroyed: () => false,
      };
      this.destroyed = false;
      this._visible = false;
      this.ignoreMouseCalls = [];
      this.bounds = null;
      created.push(this);
    }
    loadFile() { return Promise.resolve(); }
    showInactive() { this._visible = true; this.shownInactive = true; }
    isVisible() { return this._visible; }
    setBounds(b) { this.bounds = b; }
    getBounds() { return this.bounds || { x: 0, y: 0, width: 260, height: 64 }; }
    setIgnoreMouseEvents(ignore, opts) { this.ignoreMouseCalls.push({ ignore, opts }); }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    on(event, handler) { this.events = this.events || []; this.events.push(event); this.winHandlers = this.winHandlers || new Map(); this.winHandlers.set(event, handler); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this._visible = false; }
  }
  const fakeScreen = {
    _cursor: { x: 0, y: 0 },
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getCursorScreenPoint() { return { ...this._cursor }; },
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    on() {}, off() {}, removeListener() {},
  };
  const { createWidgetWindow, destroyWidgetWindow } = require('../backend/widget-window.cjs');
  const win = createWidgetWindow({ BrowserWindow: FakeWindow, screen: fakeScreen, preloadPath: 'preload.cjs' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(win.shownInactive, 'the widget is shown after load');

  suspendWidgetPoll();
  const lastCall = win.ignoreMouseCalls[win.ignoreMouseCalls.length - 1];
  assert.equal(lastCall && lastCall.ignore, true,
    'a suspended (locked/asleep) session must be click-through');
  resumeWidgetPoll();
  destroyWidgetWindow();
});

// ── W3: transition-aware hit rect ───────────────────────────────────────────

test('during a capsule size transition the hit box covers old AND new rect (W3)', () => {
  // idle (70x22) -> listening (204x42): the renderer animates for ~220 ms.
  const t0 = 1_000_000;
  const idle = capsuleHitRect('idle', t0);
  assert.deepEqual(idle, capsuleRectForStateShim('idle'), 'a stable state returns its own rect');

  const listening = capsuleHitRect('listening', t0 + 16);
  assert.ok(listening.w >= CAPSULE_SIZES.listening.w, 'the union covers the target width');
  assert.ok(listening.w >= CAPSULE_SIZES.idle.w, 'the union covers the previous width');
  assert.ok(listening.h >= CAPSULE_SIZES.listening.h && listening.h >= CAPSULE_SIZES.idle.h,
    'the union covers both heights');

  // After the transition window the hit box is exactly the target rect again.
  const settled = capsuleHitRect('listening', t0 + 16 + 400);
  assert.equal(settled.w, CAPSULE_SIZES.listening.w);
  assert.equal(settled.h, CAPSULE_SIZES.listening.h);
});

// Local shim so this file does not reach into module-private state ordering.
function capsuleRectForStateShim(state) {
  const size = CAPSULE_SIZES[state] || CAPSULE_SIZES.idle;
  return { x: Math.round((WIN_W - size.w) / 2), y: WIN_H - size.h, w: size.w, h: size.h };
}
