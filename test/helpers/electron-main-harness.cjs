'use strict';
// Loads the real `main.cjs` under a stubbed Electron so the first-run UI-language
// detection (`ensureUiLanguage`) can be exercised end-to-end without launching
// Electron. The real `backend/settings.cjs` is used (with an isolated HOME), so
// the persisted-config side effects are genuinely tested.

const fs = require('fs');
const path = require('path');

const EXTENSIONS = ['.ts', '.tsx', '.js', '.cjs'];

function resolveFile(basePath) {
  const candidates = [];
  if (path.extname(basePath)) candidates.push(basePath);
  for (const ext of EXTENSIONS) candidates.push(basePath + ext);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

// Backend modules replaced by inert stubs. `settings.cjs` is intentionally NOT
// stubbed: it is the module under test.
//
// `overrides` lets a test replace one of these stubs — the hotkey stub, for
// instance, has to be able to report that registration failed.
function backendStub(resolvedPath, overrides = {}) {
  const override = overrides[path.basename(resolvedPath)];
  if (override !== undefined) return override;
  switch (path.basename(resolvedPath)) {
    case 'hotkeys.cjs':
      return { registerHotkeys: () => true, unregisterHotkeys: () => {}, setHotkeyCallbacks: () => {}, isValidHotkey: () => true, getActiveHotkey: () => '' };
    case 'recorder.cjs':
      return {
        startRecording: async () => {}, stopRecording: async () => ({ aborted: true }),
        pauseRecording: async () => {}, resumeRecording: async () => {}, cancelRecording: async () => {},
        getState: () => 'ready',
        STATE: { READY: 'ready', RECORDING: 'recording', PAUSED: 'paused', TRANSCRIBING: 'transcribing' },
      };
    case 'secrets.cjs':
      return { getSecret: () => '', migratePlaintextKeys: (raw) => ({ settings: raw && typeof raw === 'object' ? raw : {}, migrated: false }) };
    case 'overlay-window.cjs':
      return { buildOverlayWindowOptions: () => ({ width: 1, height: 1, show: false, webPreferences: {} }) };
    case 'audio.cjs':
      return { audioByteLength: () => 0 };
    case 'history.cjs':
      return { load: () => ({ sessions: [] }), clear: () => ({ sessions: [] }) };
    case 'translation.service.cjs':
      return { warmup: async () => {} };
    case 'transcribe.cjs':
      return {
        modelDownloaded: () => false, downloadModel: async () => {},
        testDeepgramConnection: async () => ({}), testSpeechmaticsConnection: async () => ({}),
      };
    case 'engine-download.cjs':
      return {};
    case 'engine-manifest.cjs':
      return { validateFlavor: () => {}, ENGINE_FLAVORS: [] };
    case 'gemini.cjs':
      return { validateModel: async () => ({}) };
    default:
      return undefined;
  }
}

function createElectronStub(locale) {
  const handlers = new Map();
  const listeners = new Map();
  const instances = [];
  let nextId = 1;

  // Records enough window state that placement, visibility and click-through
  // assertions are possible without a real Electron process.
  class BrowserWindow {
    constructor(options) {
      this.options = options || {};
      this.webContents = {
        id: nextId++,
        sent: [],
        on() {},
        send(channel, value) { this.sent.push({ channel, value }); },
        isDestroyed: () => false,
      };
      this._destroyed = false;
      this._visible = this.options.show === true;
      this._bounds = {
        x: this.options.x ?? 0,
        y: this.options.y ?? 0,
        width: this.options.width ?? 0,
        height: this.options.height ?? 0,
      };
      this.events = [];
      this.boundsCalls = [];
      this.ignoreMouseEvents = [];
      this.alwaysOnTop = null;
      this.visibleOnAllWorkspaces = null;
      // Recorded so a test can assert which entry a window was given.
      this.loadedUrl = null;
      this.loadedFile = null;
      this.loadedFileOptions = null;
      instances.push(this);
    }
    on(event) { this.events.push(event); }
    isDestroyed() { return this._destroyed; }
    setMenuBarVisibility() {}
    setAutoHideMenuBar() {}
    setIgnoreMouseEvents(ignore, opts) { this.ignoreMouseEvents.push({ ignore, opts }); }
    loadURL(url) { this.loadedUrl = url; return Promise.resolve(); }
    loadFile(file, opts) { this.loadedFile = file; this.loadedFileOptions = opts ?? null; return Promise.resolve(); }
    setBounds(bounds) { this._bounds = { ...bounds }; this.boundsCalls.push({ ...bounds }); }
    getBounds() { return { ...this._bounds }; }
    setPosition(x, y) { this._bounds.x = x; this._bounds.y = y; }
    setAlwaysOnTop(value, level) { this.alwaysOnTop = { value, level }; }
    setVisibleOnAllWorkspaces(value, opts) { this.visibleOnAllWorkspaces = { value, opts }; }
    showInactive() { this._visible = true; this.shownInactive = true; }
    show() { this._visible = true; }
    hide() { this._visible = false; }
    isVisible() { return this._visible; }
    moveTop() {}
    focus() {}
    blur() {}
    minimize() {}
    maximize() {}
    unmaximize() {}
    isMaximized() { return false; }
    close() {}
    destroy() { this._destroyed = true; this._visible = false; }
  }

  // Minimal `screen` stand-in. `_workArea` and `_cursor` are writable so a test
  // can simulate a second monitor or a cursor over the capsule.
  const screen = {
    _workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    _cursor: { x: 0, y: 0 },
    _listeners: new Map(),
    getPrimaryDisplay() {
      return { workArea: { ...screen._workArea }, bounds: { ...screen._workArea } };
    },
    getDisplayNearestPoint() {
      return { workArea: { ...screen._workArea } };
    },
    getCursorScreenPoint() {
      return { ...screen._cursor };
    },
    on(event, handler) { screen._listeners.set(event, handler); },
    off(event) { screen._listeners.delete(event); },
    removeListener(event) { screen._listeners.delete(event); },
  };

  const app = {
    isPackaged: true,
    _locale: locale,
    setName() {},
    getLocale() { return app._locale; },
    whenReady() { return Promise.resolve(); },
    on() {},
    quit() {},
  };

  return {
    electron: {
      app,
      BrowserWindow,
      screen,
      ipcMain: {
        handle(channel, fn) { handlers.set(channel, fn); },
        on(channel, fn) { listeners.set(channel, fn); },
      },
      session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
      Menu: { setApplicationMenu() {} },
      clipboard: { writeText() {} },
      dialog: { showOpenDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 0 }) },
    },
    handlers,
    listeners,
    instances,
    screen,
    app,
  };
}

function loadWithStubs(entryPath, electron, overrides = {}) {
  const cache = new Map();
  function load(absPath) {
    if (cache.has(absPath)) return cache.get(absPath).exports;
    const code = fs.readFileSync(absPath, 'utf8');
    const mod = { exports: {} };
    const dir = path.dirname(absPath);
    cache.set(absPath, mod);
    const localRequire = (request) => {
      if (request === 'electron') return electron;
      if (request.startsWith('.')) {
        const resolved = resolveFile(path.resolve(dir, request));
        if (!resolved) throw new Error(`Cannot resolve ${request} from ${dir}`);
        const stub = backendStub(resolved, overrides);
        if (stub !== undefined) return stub;
        return load(resolved);
      }
      return require(request);
    };
    const compiled = new Function('exports', 'require', 'module', '__filename', '__dirname', code);
    compiled(mod.exports, localRequire, mod, absPath, dir);
    return mod.exports;
  }
  return load(entryPath);
}

/**
 * Load main.cjs with a stubbed Electron and the given OS locale, isolated to
 * `home`. Returns the registered IPC handlers and the created windows.
 *
 * @param {{locale: string, home: string, overrides?: object, settings?: object}} options
 *   `overrides` replaces backend stubs by module basename (e.g. 'hotkeys.cjs').
 *   `settings` is written to `<home>/.kimflow/config.json` before main.cjs is
 *   loaded, so a test can pin a flag through the real load()/normalizeSettings().
 */
async function loadMain({ locale, home, overrides = {}, settings = null }) {
  const previousUserProfile = process.env.USERPROFILE;
  const previousHome = process.env.HOME;
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  if (settings && typeof settings === 'object') {
    const configDir = path.join(home, '.kimflow');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(settings, null, 2), 'utf8');
  }

  const { electron, handlers, listeners, instances, screen, app } = createElectronStub(locale);
  loadWithStubs(path.resolve('main.cjs'), electron, overrides);
  // Flush the `app.whenReady().then(...)` microtask chain.
  await new Promise((resolve) => setImmediate(resolve));

  return {
    handlers,
    listeners,
    instances,
    screen,
    app,
    restore() {
      if (previousUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previousUserProfile;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    },
  };
}

module.exports = { loadMain };
