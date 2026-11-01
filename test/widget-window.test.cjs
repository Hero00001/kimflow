// test/widget-window.test.cjs
//
// Geometry and window options for the flow-bar widget, plus the guard that
// keeps the CSS capsule sizes and CAPSULE_SIZES from drifting apart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  WIN_W,
  WIN_H,
  BOTTOM_MARGIN,
  CAPSULE_SIZES,
  buildWidgetWindowOptions,
  computeWidgetBounds,
  capsuleRectForState,
  createWidgetWindow,
  destroyWidgetWindow,
  getWidgetWindow,
} = require('../backend/widget-window.cjs');

const CSS_PATH = path.join('src', 'widget', 'widget.css');

/** @returns {object} state -> {w,h} parsed out of the `[data-state] .pill` rules */
function capsuleSizesFromCss() {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const sizes = {};
  const rule = /\[data-state="([a-z]+)"\]\s*\.pill\s*\{([^}]*)\}/g;
  let match = rule.exec(css);
  while (match !== null) {
    const width = /--w:\s*([\d.]+)px/.exec(match[2]);
    const height = /--h:\s*([\d.]+)px/.exec(match[2]);
    if (width && height) {
      sizes[match[1]] = { w: Number(width[1]), h: Number(height[1]) };
    }
    match = rule.exec(css);
  }
  return sizes;
}

function fakeScreen(workArea) {
  const area = workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  return {
    _cursor: { x: 0, y: 0 },
    getPrimaryDisplay: () => ({ workArea: { ...area } }),
    getDisplayNearestPoint: () => ({ workArea: { ...area } }),
    getCursorScreenPoint() { return { ...this._cursor }; },
    on() {},
    off() {},
    removeListener() {},
  };
}

function fakeBrowserWindowFactory() {
  const created = [];
  class FakeWindow {
    constructor(options) {
      this.options = options || {};
      this.loadedFile = null;
      this.loadedUrl = null;
      this.shownInactive = false;
      this.destroyed = false;
      this._visible = false;
      this.ignoreMouseCalls = [];
      this.alwaysOnTop = null;
      this.allWorkspaces = null;
      this.bounds = null;
      created.push(this);
    }
    loadFile(file) { this.loadedFile = file; return Promise.resolve(); }
    showInactive() { this.shownInactive = true; this._visible = true; }
    isVisible() { return this._visible; }
    setBounds(bounds) { this.bounds = bounds; }
    getBounds() { return this.bounds || { x: 0, y: 0, width: WIN_W, height: WIN_H }; }
    setIgnoreMouseEvents(ignore, opts) { this.ignoreMouseCalls.push({ ignore, opts }); }
    setAlwaysOnTop(value, level) { this.alwaysOnTop = { value, level }; }
    setVisibleOnAllWorkspaces(value, opts) { this.allWorkspaces = { value, opts }; }
    on() {}
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this._visible = false; }
  }
  return { FakeWindow, created };
}

test('the widget window is transparent, frameless, shadowless and 260x64', () => {
  const options = buildWidgetWindowOptions({ preloadPath: 'preload.cjs', iconPath: 'icon.png' });
  assert.equal(options.width, 260);
  assert.equal(options.height, 64);
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.backgroundColor, '#00000000');
  assert.equal(options.hasShadow, false);
  assert.equal(options.resizable, false);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.focusable, false, 'the widget must never steal focus');
  assert.equal(options.show, false, 'it is shown with showInactive() after load');
  assert.equal(options.icon, 'icon.png');
});

test('the widget window stays draggable (user decision, overrides the spec)', () => {
  const options = buildWidgetWindowOptions({ preloadPath: 'preload.cjs', iconPath: 'icon.png' });
  assert.equal(options.movable, true);
});

test('the renderer is sandboxed and isolated', () => {
  const options = buildWidgetWindowOptions({ preloadPath: 'preload.cjs', iconPath: 'icon.png' });
  assert.equal(options.webPreferences.sandbox, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.nodeIntegration, false);
  assert.equal(options.webPreferences.backgroundThrottling, false);
  assert.equal(options.webPreferences.preload, 'preload.cjs');
});

test('computeWidgetBounds centres the window at the bottom of the work area', () => {
  assert.deepEqual(computeWidgetBounds({ x: 0, y: 0, width: 1920, height: 1080 }), {
    x: 830, y: 1080 - WIN_H - BOTTOM_MARGIN, width: WIN_W, height: WIN_H,
  });
});

test('computeWidgetBounds honours a work area with a non-zero origin', () => {
  // Second monitor placed to the right of the primary one.
  assert.deepEqual(computeWidgetBounds({ x: 1920, y: 0, width: 1280, height: 1024 }), {
    x: 1920 + (1280 - WIN_W) / 2, y: 1024 - WIN_H - BOTTOM_MARGIN, width: WIN_W, height: WIN_H,
  });
});

test('computeWidgetBounds handles a work area smaller than the window', () => {
  assert.deepEqual(computeWidgetBounds({ x: 0, y: 0, width: 200, height: 40 }), {
    x: -30, y: 40 - WIN_H - BOTTOM_MARGIN, width: WIN_W, height: WIN_H,
  });
});

test('computeWidgetBounds falls back to the primary origin for garbage input', () => {
  assert.deepEqual(computeWidgetBounds(null), {
    x: 0, y: WIN_H + BOTTOM_MARGIN - WIN_H - BOTTOM_MARGIN, width: WIN_W, height: WIN_H,
  });
});

test('capsuleRectForState anchors the capsule at the bottom centre', () => {
  assert.deepEqual(capsuleRectForState('idle'), { x: 95, y: 42, w: 70, h: 22 });
  assert.deepEqual(capsuleRectForState('listening'), { x: 28, y: 22, w: 204, h: 42 });
  assert.deepEqual(capsuleRectForState('paused'), { x: 28, y: 22, w: 204, h: 42 });
  assert.deepEqual(capsuleRectForState('processing'), { x: 91, y: 36, w: 78, h: 28 });
});

test('capsuleRectForState accepts recorder states and unknown values', () => {
  assert.deepEqual(capsuleRectForState('recording'), capsuleRectForState('listening'));
  assert.deepEqual(capsuleRectForState('ready'), capsuleRectForState('idle'));
  assert.deepEqual(capsuleRectForState('transcribing'), capsuleRectForState('processing'));
  assert.deepEqual(capsuleRectForState('nonsense'), capsuleRectForState('idle'));
  assert.deepEqual(capsuleRectForState(undefined), capsuleRectForState('idle'));
});

test('the capsule always fits inside the window', () => {
  for (const [state, size] of Object.entries(CAPSULE_SIZES)) {
    const rect = capsuleRectForState(state);
    assert.ok(rect.x >= 0 && rect.x + rect.w <= WIN_W, `${state} overflows horizontally`);
    assert.ok(rect.y >= 0 && rect.y + rect.h <= WIN_H, `${state} overflows vertically`);
  }
});

test('widget.css and CAPSULE_SIZES describe the same capsule', () => {
  const fromCss = capsuleSizesFromCss();
  assert.deepEqual(Object.keys(fromCss).sort(), ['idle', 'listening', 'paused', 'processing']);
  for (const [state, size] of Object.entries(CAPSULE_SIZES)) {
    assert.deepEqual(fromCss[state], size, `${state}: widget.css --w/--h drifted from CAPSULE_SIZES`);
  }
});

test('createWidgetWindow loads the static widget file and shows it without focus', async (t) => {
  const { FakeWindow, created } = fakeBrowserWindowFactory();
  const screen = fakeScreen();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow,
    screen,
    preloadPath: 'preload.cjs',
    iconPath: 'icon.png',
    getState: () => 'ready',
  });
  t.after(() => destroyWidgetWindow());

  assert.equal(created.length, 1);
  assert.equal(getWidgetWindow(), win);
  await new Promise((resolve) => setImmediate(resolve));

  assert.ok(win.loadedFile.endsWith(path.join('src', 'widget', 'widget.html')), win.loadedFile);
  assert.equal(win.loadedUrl, null, 'the widget must never be loaded from a URL');
  assert.equal(win.shownInactive, true, 'shown with showInactive(), never show()');
  assert.deepEqual(win.alwaysOnTop, { value: true, level: 'screen-saver' });
  assert.equal(win.allWorkspaces.value, true);
  assert.equal(win.allWorkspaces.opts.visibleOnFullScreen, true);
  assert.deepEqual(win.bounds, computeWidgetBounds(screen.getPrimaryDisplay().workArea));
});

test('click-through starts disabled and follows the cursor', { skip: process.platform === 'linux' }, async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const screen = fakeScreen({ x: 0, y: 0, width: 1920, height: 1080 });
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow,
    screen,
    preloadPath: 'preload.cjs',
    iconPath: 'icon.png',
    getState: () => 'recording',
  });
  t.after(() => destroyWidgetWindow());
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(win.ignoreMouseCalls[0], { ignore: true, opts: undefined });

  // Park the cursor inside the listening capsule: window origin + capsule box.
  const origin = computeWidgetBounds({ x: 0, y: 0, width: 1920, height: 1080 });
  const rect = capsuleRectForState('listening');
  screen._cursor = { x: origin.x + rect.x + rect.w / 2, y: origin.y + rect.y + rect.h / 2 };
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(win.ignoreMouseCalls.at(-1).ignore, false, 'the capsule must accept clicks when hovered');

  // Move the cursor far away again: clicks must pass through.
  screen._cursor = { x: 5, y: 5 };
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(win.ignoreMouseCalls.at(-1).ignore, true);
});

test('destroyWidgetWindow destroys the window and forgets it', async (t) => {
  const { FakeWindow } = fakeBrowserWindowFactory();
  const win = createWidgetWindow({
    BrowserWindow: FakeWindow,
    screen: fakeScreen(),
    preloadPath: 'preload.cjs',
    iconPath: 'icon.png',
  });
  t.after(() => destroyWidgetWindow());
  await new Promise((resolve) => setImmediate(resolve));

  destroyWidgetWindow();
  assert.equal(win.destroyed, true);
  assert.equal(getWidgetWindow(), null);
  // Idempotent: a second teardown must not throw.
  assert.doesNotThrow(() => destroyWidgetWindow());
});

test('createWidgetWindow requires a BrowserWindow constructor', () => {
  assert.throws(() => createWidgetWindow({}), /BrowserWindow constructor/);
});
