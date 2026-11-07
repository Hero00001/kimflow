// Flow-bar widget BrowserWindow: creation, placement, teardown and
// click-through.
//
// Electron is INJECTED (`createWidgetWindow({ BrowserWindow, screen, ... })`)
// rather than required at module scope, so the geometry helpers stay pure and
// unit-testable without an Electron stub — the same approach
// backend/overlay-window.cjs uses for its options.
//
// The OS window is a fixed 260x64 transparent canvas. The capsule is drawn
// inside it and only changes CSS size, so a state change never resizes the
// window (no flicker, no re-positioning, no focus churn).
const path = require('path');

const WIN_W = 260;
const WIN_H = 64;
const BOTTOM_MARGIN = 20;

// Capsule box per state, in window-local CSS pixels. The capsule is anchored
// to the bottom-centre of the window (see capsuleRectForState).
//
// These MUST match the --w/--h values in src/widget/widget.css:
// test/widget-window.test.cjs parses the stylesheet and fails if the two ever
// drift apart.
const CAPSULE_SIZES = {
  idle: { w: 70, h: 22 },
  listening: { w: 204, h: 42 },
  paused: { w: 204, h: 42 },
  processing: { w: 78, h: 28 },
};

// backend/recorder.cjs owns the state vocabulary; accept it here too so a
// caller can pass `getState()` straight through without translating.
const RECORDER_STATE_ALIAS = {
  ready: 'idle',
  recording: 'listening',
  paused: 'paused',
  transcribing: 'processing',
};

const WIDGET_HTML_PATH = path.join(__dirname, '..', 'src', 'widget', 'widget.html');

// Click-through is computed HERE, not in the renderer.
//
// The design spec drove it from `pill.mouseenter`/`mouseleave`, which cannot
// work: Chromium swallows every page mouse event inside a
// `-webkit-app-region: drag` region, and the capsule has to stay draggable.
// `mouseenter` would never fire, the window would stay click-through, and the
// capsule could never be clicked or dragged. So the main process polls the
// cursor and hit-tests it against the capsule box instead — no renderer → main
// hover IPC at all.
const POLL_INTERVAL_MS = 16; // one tick per frame
const HOVER_INFLATE = 4; // hysteresis: inflate the hit box by 4px
const HOVER_CONFIRM_TICKS = 2; // ...and require two agreeing ticks
const DRAG_PAUSE_MS = 250; // never flip click-through in the middle of a drag
// The widget can end up off-screen without leaving the process: a display
// change while the OS reports a transient work area, a GPU hiccup, or the
// user dragging the capsule off the visible area. The poll checks for this
// roughly once a second (RESCUE_EVERY ticks of POLL_INTERVAL_MS).
const RESCUE_EVERY = 62;
// A crashed widget renderer leaves the window alive but renders nothing —
// with a transparent frameless window that is indistinguishable from "the
// widget disappeared". Reload to bring it back, but stop after repeated
// crashes so a genuine bug cannot spin the renderer forever.
const MAX_RENDERER_RELOADS = 3;
// After the reload cap, one full window recreate is allowed per cool-down: a
// fresh window resets the crash counter and re-anchors the capsule. Without
// it, a crashier environment (transparent window + GPU hiccups during display
// mode changes) leaves an invisible corpse — the exact "widget randomly
// disappeared" report. The cool-down keeps a genuinely broken GPU/driver from
// spinning new windows forever.
const RECREATE_COOLDOWN_MS = 30000;
const RELOAD_WINDOW_MS = 30000;

let widgetWindow = null;
let pollTimer = null;
let screenApi = null;
let stateReader = defaultRecorderState;
// Options of the most recent createWidgetWindow call, so crash recovery can
// rebuild the window exactly as the owner created it.
let lastCreateOptions = null;
let lastRecreateAt = 0;
let displayListenerTarget = null;
let displayListeners = [];
let cursorInside = null; // last applied hit-test result
let candidateInside = null; // current candidate, waiting for confirmation
let candidateTicks = 0;
let pollPausedUntil = 0;
let pollTicks = 0; // counts towards the periodic off-screen rescue

/**
 * Default state source: the recorder, read lazily so requiring this module
 * never pulls in the audio/transcription stack.
 *
 * @returns {string} a recorder state ('ready' | 'recording' | 'paused' | 'transcribing')
 */
function defaultRecorderState() {
  try {
    return require('./recorder.cjs').getState();
  } catch {
    return 'ready';
  }
}

function isDestroyed(win) {
  try {
    return typeof win.isDestroyed === 'function' ? win.isDestroyed() === true : false;
  } catch {
    return true;
  }
}

function isFiniteRect(rect) {
  return Boolean(rect)
    && Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height);
}

/**
 * BrowserWindow options for the widget. Transparent, frameless and shadowless:
 * without `hasShadow: false` the OS paints a rectangular drop shadow around
 * the window, which is visible as square fringes at the capsule's corners.
 *
 * `movable` is true (the spec said false): the capsule stays draggable, which
 * the user relies on to move it out of the way.
 *
 * @param {{preloadPath?: string, iconPath?: string}} options
 * @returns {object} Electron BrowserWindow options
 */
function buildWidgetWindowOptions({ preloadPath, iconPath } = {}) {
  return {
    width: WIN_W,
    height: WIN_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // never steal focus from the app the user is typing in
    alwaysOnTop: true,
    title: 'KimFlow',
    icon: iconPath,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep animations smooth while another app is focused
    },
  };
}

/**
 * Bottom-centre placement for a display work area.
 *
 * @param {{x:number,y:number,width:number,height:number}} workArea
 * @returns {{x:number,y:number,width:number,height:number}} window bounds
 */
function computeWidgetBounds(workArea) {
  const area = isFiniteRect(workArea)
    ? workArea
    : { x: 0, y: 0, width: WIN_W, height: WIN_H + BOTTOM_MARGIN };
  return {
    x: Math.round(area.x + (area.width - WIN_W) / 2),
    y: Math.round(area.y + area.height - WIN_H - BOTTOM_MARGIN),
    width: WIN_W,
    height: WIN_H,
  };
}

/**
 * The capsule box inside the window, anchored bottom-centre.
 *
 * Accepts a widget state or a recorder state; anything unknown falls back to
 * the idle capsule.
 *
 * @param {string} state
 * @returns {{x:number,y:number,w:number,h:number}}
 */
function capsuleRectForState(state) {
  const normalized = RECORDER_STATE_ALIAS[state] || state;
  const size = CAPSULE_SIZES[normalized] || CAPSULE_SIZES.idle;
  return {
    x: Math.round((WIN_W - size.w) / 2),
    y: WIN_H - size.h,
    w: size.w,
    h: size.h,
  };
}

function getWidgetWindow() {
  return widgetWindow;
}

/**
 * Work area of the display the cursor is on, so the capsule follows the user
 * across monitors.
 *
 * @returns {{x:number,y:number,width:number,height:number}|null}
 */
function activeWorkArea() {
  const screenRef = screenApi;
  if (!screenRef) return null;
  let display = null;
  try {
    if (typeof screenRef.getCursorScreenPoint === 'function'
      && typeof screenRef.getDisplayNearestPoint === 'function') {
      display = screenRef.getDisplayNearestPoint(screenRef.getCursorScreenPoint());
    }
  } catch {
    display = null;
  }
  if (!display) {
    try {
      display = typeof screenRef.getPrimaryDisplay === 'function' ? screenRef.getPrimaryDisplay() : null;
    } catch {
      display = null;
    }
  }
  const area = display && display.workArea ? display.workArea : null;
  return isFiniteRect(area) ? area : null;
}

/** Re-anchor the window at the bottom-centre of the cursor's display. */
function positionWidget() {
  const win = widgetWindow;
  if (!win || isDestroyed(win)) return;
  if (typeof win.setBounds !== 'function') return;
  const area = activeWorkArea();
  if (!area) return;
  try {
    win.setBounds(computeWidgetBounds(area));
  } catch {
    // The window died between the check and the call; the next tick retries.
  }
}

/**
 * True when `bounds` shares area with at least one display's workArea.
 *
 * An unusable display list ("cannot tell") counts as on-screen so a broken
 * `screen` implementation can never fling the widget around; a usable list
 * where nothing intersects counts as off-screen.
 *
 * @param {{x:number,y:number,width:number,height:number}} bounds
 * @param {Array<{workArea?:object}>|null} displays
 * @returns {boolean}
 */
function rectIntersectsAnyDisplay(bounds, displays) {
  if (!isFiniteRect(bounds)) return false;
  if (!Array.isArray(displays) || displays.length === 0) return true;
  let sawUsableArea = false;
  for (const display of displays) {
    const area = display && display.workArea;
    if (!isFiniteRect(area)) continue;
    sawUsableArea = true;
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    if (overlapX > 0 && overlapY > 0) return true;
  }
  // A list that exists but contains no usable workArea is "cannot tell":
  // the rescue must not fling the window around based on a guess.
  return !sawUsableArea;
}

/**
 * Bring the widget back if it ended up where the user cannot see it.
 *
 * Unlike positionWidget this is a no-op while the window still overlaps any
 * display: a user-dragged capsule must stay exactly where it was dropped,
 * even when the OS fires display-metrics-changed (taskbar auto-hide, DPI
 * change, a fullscreen app opening). Only a window that is fully outside
 * every workArea is re-anchored.
 */
function ensureOnScreen() {
  const win = widgetWindow;
  if (!win || isDestroyed(win)) return;
  if (!screenApi || typeof screenApi.getAllDisplays !== 'function') return;
  if (typeof win.getBounds !== 'function') return;
  let bounds = null;
  let displays = null;
  try {
    bounds = win.getBounds();
    displays = screenApi.getAllDisplays();
  } catch {
    return;
  }
  if (rectIntersectsAnyDisplay(bounds, displays)) return;
  positionWidget();
}

function removeDisplayListeners() {
  const target = displayListenerTarget;
  if (target) {
    for (const entry of displayListeners) {
      try {
        if (typeof target.removeListener === 'function') target.removeListener(entry.event, entry.handler);
        else if (typeof target.off === 'function') target.off(entry.event, entry.handler);
      } catch {
        // The screen module is gone; nothing left to detach.
      }
    }
  }
  displayListeners = [];
  displayListenerTarget = null;
}

// Registered per window (never at module scope) so a recreated window does not
// stack duplicate listeners on the screen module.
function registerDisplayListeners() {
  removeDisplayListeners();
  const screenRef = screenApi;
  if (!screenRef || typeof screenRef.on !== 'function') return;
  displayListenerTarget = screenRef;
  for (const event of ['display-metrics-changed', 'display-added', 'display-removed']) {
    // Rescue-only: a visible, user-placed capsule must not be snapped back
    // to bottom-centre by routine display events. ensureOnScreen re-anchors
    // the window only when it is fully off-screen.
    const handler = () => ensureOnScreen();
    try {
      screenRef.on(event, handler);
      displayListeners.push({ event, handler });
    } catch {
      // Event unsupported on this platform/Electron build.
    }
  }
}

function applyIgnoreMouse(ignore) {
  const win = widgetWindow;
  if (!win || isDestroyed(win)) return;
  // setIgnoreMouseEvents' `forward` option is unsupported on Linux, and
  // ignoring mouse events there would leave the capsule permanently
  // uninteractive — so never call it on Linux at all.
  if (process.platform === 'linux') return;
  try {
    if (typeof win.setIgnoreMouseEvents === 'function') win.setIgnoreMouseEvents(ignore);
  } catch {
    // Best-effort: a failure here only costs click-through, never the window.
  }
}

function stopMousePoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Set while the machine is asleep or locked (powerMonitor): the 16 ms poll
// stops entirely (W5) and the window is forced click-through so a locked
// session can never sit under a click-blocking transparent rect.
let pollSuspendedByPower = false;

/** powerMonitor suspend/lock-screen: freeze the poll, force click-through. */
function suspendWidgetPoll() {
  pollSuspendedByPower = true;
  stopMousePoll();
  applyIgnoreMouse(true);
}

/** powerMonitor resume/unlock-screen: the poll re-arms on a visible window. */
function resumeWidgetPoll() {
  pollSuspendedByPower = false;
  const win = widgetWindow;
  if (!win || isDestroyed(win)) return;
  if (typeof win.isVisible === 'function') {
    try { if (win.isVisible() === false) return; } catch { /* assume visible */ }
  }
  startMousePoll();
}

function startMousePoll() {
  if (pollTimer) return;
  if (pollSuspendedByPower) return;
  if (process.platform === 'linux') return; // see applyIgnoreMouse
  pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
  // Never keep the process (or a test run) alive just for the poll.
  if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
}

// The renderer animates the capsule size over ~220 ms of CSS transition while
// this process reads the FINAL size instantly. For a short window after a
// state change the hit box is the UNION of the previous and target rects:
// clicks can then never pass through a still-visible capsule, nor block an
// area that has not grown yet (W3). Union-biasing toward click-blocking is
// the safe direction of the two failure modes.
const HIT_TRANSITION_MS = 250;
let hitRectState = null;
let hitRectPrevious = null;
let hitRectChangedAt = 0;

/**
 * The click-through hit box for the current capsule, transition-aware.
 * @param {string} state recorder/widget state
 * @param {number} [now] injectable clock for tests
 */
function capsuleHitRect(state, now = Date.now()) {
  const rect = capsuleRectForState(state);
  if (state !== hitRectState) {
    hitRectState = state;
    hitRectChangedAt = now;
    hitRectPrevious = hitRectPrevious || rect;
  }
  const prev = hitRectPrevious;
  const transitioning = prev && now - hitRectChangedAt < HIT_TRANSITION_MS
    && (prev.x !== rect.x || prev.w !== rect.w || prev.h !== rect.h);
  if (!transitioning) {
    hitRectPrevious = rect;
    return rect;
  }
  const x = Math.min(prev.x, rect.x);
  const y = Math.min(prev.y, rect.y);
  const right = Math.max(prev.x + prev.w, rect.x + rect.w);
  const bottom = Math.max(prev.y + prev.h, rect.y + rect.h);
  return { x, y, w: right - x, h: bottom - y };
}

function pollTick() {
  const win = widgetWindow;
  if (!win || isDestroyed(win)) {
    stopMousePoll();
    return;
  }
  // A drag in progress must never flip click-through: the cursor can leave the
  // capsule mid-drag, which would otherwise drop the window.
  if (Date.now() < pollPausedUntil) return;
  if (typeof win.isVisible === 'function') {
    let visible = true;
    try {
      visible = win.isVisible() !== false;
    } catch {
      visible = true;
    }
    if (!visible) return;
  }
  // Periodic off-screen rescue (~once a second while visible).
  pollTicks += 1;
  if (pollTicks >= RESCUE_EVERY) {
    pollTicks = 0;
    ensureOnScreen();
  }
  const screenRef = screenApi;
  if (!screenRef || typeof screenRef.getCursorScreenPoint !== 'function') return;
  if (typeof win.getBounds !== 'function') return;

  let cursor = null;
  let bounds = null;
  try {
    cursor = screenRef.getCursorScreenPoint();
    bounds = win.getBounds();
  } catch {
    return;
  }
  if (!cursor || !bounds) return;

  const rect = capsuleHitRect(stateReader());
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  const inside = x >= rect.x - HOVER_INFLATE && x <= rect.x + rect.w + HOVER_INFLATE
    && y >= rect.y - HOVER_INFLATE && y <= rect.y + rect.h + HOVER_INFLATE;

  // Hysteresis: the 4px inflation above means the cursor must travel well past
  // the edge to flip, and two agreeing ticks mean a single stray reading (or a
  // 1-frame cursor jump) cannot toggle click-through on its own.
  if (candidateInside === inside) candidateTicks += 1;
  else {
    candidateInside = inside;
    candidateTicks = 1;
  }
  if (candidateTicks < HOVER_CONFIRM_TICKS) return;
  if (cursorInside === inside) return;
  cursorInside = inside;
  applyIgnoreMouse(!inside);
}

function registerWindowListeners(win) {
  if (!win || typeof win.on !== 'function') return;
  // Navigation hardening (#03/W2): the widget loads exactly one page over
  // file:// and must never navigate or open windows. The preload re-runs on
  // every navigation and re-grants the bridge by page path, so a navigated
  // widget could otherwise escalate beyond its six-key surface.
  try {
    if (win.webContents && typeof win.webContents.on === 'function') {
      win.webContents.on('will-navigate', (event, url) => {
        const allowed = /^file:.*\/widget\.html($|[?#])/i.test(String(url || ''));
        if (allowed) return;
        console.error(`[KimFlow] Blocked navigation on the floating widget: ${String(url).slice(0, 120)}`);
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
      });
      if (typeof win.webContents.setWindowOpenHandler === 'function') {
        win.webContents.setWindowOpenHandler(({ url }) => {
          console.error(`[KimFlow] Blocked window.open on the floating widget: ${String(url).slice(0, 120)}`);
          return { action: 'deny' };
        });
      }
    }
  } catch { /* stub environments */ }
  const pausePoll = () => {
    pollPausedUntil = Date.now() + DRAG_PAUSE_MS;
  };
  for (const event of ['move', 'will-move']) {
    try {
      win.on(event, pausePoll);
    } catch {
      // 'will-move' is not emitted on every platform.
    }
  }
  try {
    win.on('hide', () => stopMousePoll());
  } catch {
    // Optional event; ignore.
  }
  try {
    win.on('show', () => startMousePoll());
  } catch {
    // Optional event; ignore.
  }
  // Renderer-crash recovery: with a transparent frameless window, a crashed
  // renderer is invisible to the user — the widget simply "disappears".
  // Reload brings the page back; the consecutive-crash guard stops a real
  // bug from spinning the renderer forever.
  let reloads = 0;
  let lastGoneAt = 0;
  try {
    if (win.webContents && typeof win.webContents.on === 'function') {
      win.webContents.on('render-process-gone', (_event, details) => {
        const reason = details && details.reason ? details.reason : 'unknown';
        const now = Date.now();
        reloads = now - lastGoneAt < RELOAD_WINDOW_MS ? reloads + 1 : 1;
        lastGoneAt = now;
        console.error(`[KimFlow] Widget renderer gone (${reason}); recovery reload ${reloads}/${MAX_RENDERER_RELOADS}`);
        if (isDestroyed(win)) return;
        if (reloads > MAX_RENDERER_RELOADS) {
          // Plain reloads are exhausted. Leaving the window dead and blank is
          // indistinguishable from the widget vanishing — recreate it from the
          // original options instead. The cool-down bounds a genuinely broken
          // environment to one recreate per interval.
          if (now - lastRecreateAt < RECREATE_COOLDOWN_MS) {
            console.error('[KimFlow] Widget recreate skipped (cool-down active); the next crash retries');
            return;
          }
          lastRecreateAt = now;
          console.error('[KimFlow] Recreating the widget window after repeated renderer crashes');
          try {
            createWidgetWindow(lastCreateOptions || {});
          } catch (error) {
            console.error('[KimFlow] Widget recreation failed:', error instanceof Error ? error.message : error);
          }
          return;
        }
        try {
          if (win.webContents && typeof win.webContents.reload === 'function') {
            win.webContents.reload();
          }
        } catch {
          // Best-effort: the poll's rescue paths keep running either way.
        }
      });
    }
  } catch {
    // webContents events are unavailable in some stubs; nothing to do.
  }
}

/**
 * Create the floating flow-bar widget window.
 *
 * `dev` is accepted for symmetry with the other window factories and is
 * deliberately unused: the widget is a plain static file that `loadFile`
 * resolves identically in dev, `npm start` and the packaged asar.
 *
 * @param {{BrowserWindow: Function, screen?: object, preloadPath?: string,
 *          iconPath?: string, dev?: boolean, getState?: () => string}} options
 * @returns {object} the created BrowserWindow
 */
function createWidgetWindow(options) {
  const opts = options || {};
  const BrowserWindowCtor = opts.BrowserWindow;
  if (typeof BrowserWindowCtor !== 'function') {
    throw new Error('createWidgetWindow requires a BrowserWindow constructor');
  }

  destroyWidgetWindow();

  // Kept for crash-recovery recreation. `onCreated` (below) lets the owner
  // re-point its window reference for every creation, initial or recreate.
  lastCreateOptions = opts;

  screenApi = opts.screen || null;
  stateReader = typeof opts.getState === 'function' ? opts.getState : defaultRecorderState;

  const win = new BrowserWindowCtor(buildWidgetWindowOptions({
    preloadPath: opts.preloadPath,
    iconPath: opts.iconPath,
  }));
  widgetWindow = win;
  if (typeof opts.onCreated === 'function') {
    try {
      opts.onCreated(win);
    } catch {
      // The owner keeps its previous reference; nothing this module can do.
    }
  }

  // Both calls are optional platform niceties: a failure must degrade to a
  // normal always-on-top window instead of breaking creation.
  try {
    if (typeof win.setAlwaysOnTop === 'function') win.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    // Ignored: the constructor's alwaysOnTop already applied.
  }
  try {
    if (typeof win.setVisibleOnAllWorkspaces === 'function') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    }
  } catch {
    // Ignored: not supported everywhere.
  }

  // Click-through until the first hit test lands, so the invisible window never
  // swallows a click on the app underneath.
  applyIgnoreMouse(true);
  registerDisplayListeners();
  registerWindowListeners(win);

  const loaded = typeof win.loadFile === 'function' ? win.loadFile(WIDGET_HTML_PATH) : Promise.resolve();
  Promise.resolve(loaded)
    .then(() => {
      positionWidget();
      try {
        if (typeof win.showInactive === 'function') win.showInactive(); // never show(): it takes focus
      } catch {
        // Ignored: the window still exists, it is just not visible yet.
      }
      startMousePoll();
    })
    .catch((error) => {
      // A silent failure here shipped an invisible widget with zero
      // diagnostics — at least say why the capsule never appeared.
      console.error('[KimFlow] Widget window failed to load:', error instanceof Error ? error.message : error);
    });

  return win;
}

/** Destroy the widget window and release its timer and screen listeners. */
function destroyWidgetWindow() {
  stopMousePoll();
  removeDisplayListeners();
  const win = widgetWindow;
  widgetWindow = null;
  screenApi = null;
  stateReader = defaultRecorderState;
  cursorInside = null;
  candidateInside = null;
  candidateTicks = 0;
  pollPausedUntil = 0;
  pollTicks = 0;
  pollSuspendedByPower = false;
  hitRectState = null;
  hitRectPrevious = null;
  hitRectChangedAt = 0;
  if (win && !isDestroyed(win)) {
    try {
      win.destroy();
    } catch {
      // Already gone.
    }
  }
}

module.exports = {
  WIN_W,
  WIN_H,
  BOTTOM_MARGIN,
  CAPSULE_SIZES,
  WIDGET_HTML_PATH,
  buildWidgetWindowOptions,
  computeWidgetBounds,
  capsuleRectForState,
  capsuleHitRect,
  rectIntersectsAnyDisplay,
  createWidgetWindow,
  positionWidget,
  ensureOnScreen,
  suspendWidgetPoll,
  resumeWidgetPoll,
  destroyWidgetWindow,
  getWidgetWindow,
};
