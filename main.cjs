const { app, BrowserWindow, ipcMain, session, Menu, clipboard, dialog, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const { registerHotkeys, unregisterHotkeys, setHotkeyCallbacks, isValidHotkey, getActiveHotkey } = require('./backend/hotkeys.cjs');
const {
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  cancelRecording,
  getState,
  STATE,
} = require('./backend/recorder.cjs');
const { getSecret, setSecretsDir, migrateSecrets } = require('./backend/secrets.cjs');
const { loadSettings, saveSettings, normalizeSettings, CONFIG_DIR, getLoadStatus, blankSecretValues } = require('./backend/settings.cjs');
const { buildOverlayWindowOptions } = require('./backend/overlay-window.cjs');
const { createWidgetWindow, destroyWidgetWindow, suspendWidgetPoll, resumeWidgetPoll } = require('./backend/widget-window.cjs');
const { audioByteLength } = require('./backend/audio.cjs');
const history = require('./backend/history.cjs');
// Persistent SendInput paste helper — killed on quit so no PowerShell child
// outlives the app.
const { shutdownPasteHelper } = require('./backend/paste-helper.cjs');

let mainWindow;
let overlayWindow;
// Which floating UI actually exists. Assigned once in createWindows() from the
// same value that chooses the window, so the mic-level gate below can never
// disagree with the window that was really created.
let flowBarEnabled = false;
let ipcRegistered = false;
let rendererReady = false;
let pendingHotkey = null;
// Floating-window actions waiting for the main renderer to come back. Entries
// are stamped so a stale burst is never replayed after a crash (A2).
let pendingOverlayActions = [];
// A dead main renderer used to stay dead: the hotkey relay and every floating
// action silently stopped working. Recovery mirrors the widget's approach —
// bounded reloads with a crash counter (A2).
const MAX_MAIN_RELOADS = 5;
const MAIN_RELOAD_WINDOW_MS = 60000;
let mainWindowReloads = 0;
let lastMainGoneAt = 0;
// Queued floating actions are bounded and expire: a widget button press is
// only meaningful for a few seconds, and replaying an unbounded stale burst
// after a reload produced start/stop chaos.
const MAX_PENDING_OVERLAY_ACTIONS = 20;
const PENDING_ACTION_TTL_MS = 15000;
const APP_NAME = 'KimFlow';
// UI languages the renderer can display. Kept in sync with
// backend/settings.cjs's UI_LANGUAGES and src/i18n's UILanguage union.
const UI_LANGUAGES = ['en', 'ar', 'zh'];
// 10 minutes of 16 kHz mono 16-bit WAV is under 20 MB; anything far beyond
// that is a malformed or abusive payload, rejected before Buffer allocation.
const MAX_STOP_AUDIO_BYTES = 64 * 1024 * 1024;
const ICON_PATH = path.join(__dirname, 'app icon', 'icon.ico');
app.setName(APP_NAME);
// Paths the MAIN process itself handed out for the whisper binary (the file
// dialog result and managed engine installs). A renderer-supplied path that
// was never handed out by main must not reach execFile (N4) or the
// check-whisper existence oracle (#04).
const knownBinaryPaths = new Set();
// Main-owned persistence for dialog-selected binaries: config.json's
// whisperBinaryPath is renderer-writable (and therefore not trusted across
// restarts), but the user's dialog choice must survive one. This file lives
// in userData, which the renderer has no API to write.
let trustedBinariesFile = null;

/**
 * Trust a binary for this session AND persist it across restarts.
 * The in-memory set is enough for engine-managed paths (re-seeded each
 * start); dialog selections need the file.
 */
function rememberTrustedBinary(binaryPath) {
  if (typeof binaryPath !== 'string' || !binaryPath) return;
  knownBinaryPaths.add(binaryPath);
  if (!trustedBinariesFile) return;
  try {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(trustedBinariesFile, 'utf8')); } catch { /* first entry */ }
    if (!Array.isArray(list)) list = [];
    if (!list.includes(binaryPath)) list.push(binaryPath);
    if (list.length > 20) list = list.slice(-20);
    fs.writeFileSync(trustedBinariesFile, JSON.stringify(list, null, 2), 'utf8');
  } catch { /* best-effort: the path is still trusted for this session */ }
}

// First-run UI-language detection.
//
// '' means "the user has never chosen a UI language". We resolve it once from
// the OS locale and persist the concrete value, so this runs exactly once.
// Because '' and 'en' are distinct, a user who deliberately picks English on
// an Arabic machine is never re-detected back to Arabic. Mirrors the
// inputLanguageMigrated one-time-migration pattern in backend/settings.cjs.
function ensureUiLanguage(settings) {
  // Only persist a detected UI language when we actually read a real config.
  // If the last load failed (locked file, corrupt JSON), writing defaults here
  // would overwrite the user's real settings (A1 / F-11). On a first run
  // (status 'missing') the defaults ARE the correct baseline, so detection
  // still persists.
  if (settings && settings.uiLanguage === '' && getLoadStatus() !== 'read-error' && getLoadStatus() !== 'corrupt') {
    const code = String(app.getLocale() || '').slice(0, 2).toLowerCase();
    settings.uiLanguage = UI_LANGUAGES.includes(code) ? code : 'en';
    try {
      saveSettings(settings);
    } catch {
      // A read-only config must never break startup; the value still reaches
      // the renderer for this session.
    }
  }
  return settings;
}

function destroyOverlayWindow() {
  // The flow-bar widget lives in its own module with a poll timer and screen
  // listeners, so tearing it down is not just window.destroy().
  destroyWidgetWindow();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
}

/**
 * Which floating UI to create: the new flow-bar widget or the legacy overlay.
 *
 * Default is ON. A stored config from before this release has no
 * `useFlowBarWidget` key and therefore gets the new widget; only an explicit
 * `false` (in ~/.kimflow/config.json) rolls back, and KIMFLOW_FLOWBAR=0 forces
 * the legacy path for a single launch.
 *
 * @param {object} settings normalized settings
 * @returns {boolean}
 */
function isFlowBarWidgetEnabled(settings) {
  if (process.env.KIMFLOW_FLOWBAR === '0') return false;
  // Linux: click-through is disabled there (setIgnoreMouseEvents with
  // forward is unreliable), so the always-on-top transparent capsule would
  // swallow every click in its whole rect, forever (W1). The legacy overlay
  // owns its small input area and is the safe floating UI on Linux.
  if (process.platform === 'linux') return false;
  return !settings || settings.useFlowBarWidget !== false;
}

function sendToWindows(channel, value) {
  for (const window of [mainWindow, overlayWindow]) {
    if (!window || window.isDestroyed()) continue;
    if (window.webContents?.isDestroyed?.() === true) continue;
    try {
      window.webContents.send(channel, value);
    } catch { /* window died mid-send */ }
  }
}

function isDevelopment() {
  return Boolean(process.env.ELECTRON_DEV_HOST) || !app.isPackaged;
}

/** True when the renderer is served by the Vite dev server. */
function isDevServer() {
  return process.argv.includes('--dev') || Boolean(process.env.ELECTRON_DEV_HOST);
}

function getRendererEntry() {
  const devHost = process.env.ELECTRON_DEV_HOST || 'localhost';
  const builtIndex = path.join(__dirname, 'dist', 'index.html');
  if (isDevServer()) {
    return { type: 'url', value: `http://${devHost}:1420` };
  }
  if (isDevelopment() && !fs.existsSync(builtIndex)) return { type: 'url', value: `http://${devHost}:1420` };
  return { type: 'file', value: builtIndex };
}

function getOverlayEntry() {
  const devHost = process.env.ELECTRON_DEV_HOST || 'localhost';
  // In development the overlay must come from the dev server too, like the
  // main window. Loading the source `src/overlay.html` over file:// would
  // resolve its `<script src="/src/overlay.ts">` to the filesystem root, so
  // the overlay would render with no JavaScript at all: dead buttons and a
  // state text that never changes.
  if (isDevServer()) {
    return { type: 'url', value: `http://${devHost}:1420/src/overlay.html` };
  }
  const builtOverlay = path.join(__dirname, 'dist', 'src', 'overlay.html');
  return fs.existsSync(builtOverlay)
    ? { type: 'file', value: builtOverlay }
    : { type: 'file', value: path.join(__dirname, 'src', 'overlay.html') };
}

async function loadEntry(window, entry) {
  if (entry.type === 'url') await window.loadURL(entry.value);
  else await window.loadFile(entry.value);
}

function createWindows() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    resizable: true,
    title: APP_NAME,
    icon: ICON_PATH,
    frame: isMac,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Same sandbox as the widget (N5): the preload uses only
      // contextBridge/ipcRenderer, which sandboxed preloads support.
      sandbox: true,
    },
  });

  if (!isMac) {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);
  }
  hardenWindow(mainWindow, 'main window');

  mainWindow.webContents.on('did-start-loading', () => {
    rendererReady = false;
    if (getState() === STATE.RECORDING || getState() === STATE.TRANSCRIBING) {
      void cancelRecording([mainWindow, overlayWindow]);
    }
  });
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    if (pendingHotkey) {
      const event = pendingHotkey;
      pendingHotkey = null;
      mainWindow.webContents.send('hotkey-pressed', event);
    }
    // Replay only actions that are still meaningful: a queue that survived a
    // crash must not fire a stale start/stop burst into the fresh renderer.
    const now = Date.now();
    const fresh = pendingOverlayActions.filter((entry) => now - entry.at <= PENDING_ACTION_TTL_MS);
    pendingOverlayActions = [];
    for (const entry of fresh) {
      mainWindow.webContents.send('overlay-action', entry.action);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    rendererReady = false;
    void cancelRecording([mainWindow, overlayWindow]);
    // Actions queued before the crash describe a dead session — drop them.
    pendingOverlayActions = [];
    const now = Date.now();
    mainWindowReloads = now - lastMainGoneAt < MAIN_RELOAD_WINDOW_MS ? mainWindowReloads + 1 : 1;
    lastMainGoneAt = now;
    console.error(`[KimFlow] Main renderer gone (${details && details.reason ? details.reason : 'unknown'}); recovery reload ${mainWindowReloads}/${MAX_MAIN_RELOADS}`);
    if (mainWindowReloads > MAX_MAIN_RELOADS || !mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.webContents.reload();
    } catch (error) {
      console.error('[KimFlow] Main renderer reload failed:', error instanceof Error ? error.message : error);
    }
  });
  loadEntry(mainWindow, getRendererEntry()).catch((error) => {
    console.error('[KimFlow] Failed to load main window:', error);
  });

  // Read once and remember: `mic-level` gates on the same variable, so the
  // forwarded feed always matches the floating window that actually exists.
  flowBarEnabled = isFlowBarWidgetEnabled(loadSettings());
  if (flowBarEnabled) {
    // New text-free flow-bar capsule. Same role as the legacy overlay: it is
    // `overlayWindow`, so it is trusted by assertTrustedSender, receives
    // `recording-state` through sendToWindows, and forwards actions over the
    // existing `overlay-action` channel. No new recording logic.
    overlayWindow = createWidgetWindow({
      BrowserWindow,
      screen,
      dev: isDevelopment(),
      preloadPath: path.join(__dirname, 'preload.cjs'),
      iconPath: ICON_PATH,
      // Crash recovery recreates the window inside the module; without this
      // the owner would keep pointing at the dead window and every IPC send
      // from the fresh widget would fail assertTrustedSender.
      onCreated: (win) => { overlayWindow = win; },
    });
  } else {
    overlayWindow = new BrowserWindow(buildOverlayWindowOptions({
      preloadPath: path.join(__dirname, 'preload.cjs'),
      iconPath: ICON_PATH,
    }));
    // The overlay owns its controls, so it must receive mouse input. Its
    // controls can be moved with the frameless window drag region.
    overlayWindow.setIgnoreMouseEvents(false);
    // Show after first paint, not at creation: a transparent window shown
    // before its page is ready flashed a white rectangle (#18).
    loadEntry(overlayWindow, getOverlayEntry())
      .then(() => {
        if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.showInactive();
      })
      .catch((error) => {
        console.error('[KimFlow] Failed to load overlay window:', error);
      });
  }
  hardenWindow(overlayWindow, 'floating window');

  mainWindow.on('closed', () => {
    rendererReady = false;
    void cancelRecording([mainWindow, overlayWindow]);
    destroyOverlayWindow();
    mainWindow = null;
  });
  overlayWindow.on('closed', () => {
    // The floating window dying on its own must tear the widget subsystem
    // down too: the module-level 16 ms poll and the screen listeners
    // otherwise leak until quit (W9). destroyWidgetWindow is idempotent and
    // no-ops when the main window already tore everything down.
    destroyWidgetWindow();
    overlayWindow = null;
  });
}

function requestRendererHotkey(pressed) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!rendererReady) {
    pendingHotkey = { pressed };
    return;
  }
  mainWindow.webContents.send('hotkey-pressed', { pressed });
}

/**
 * Non-throwing sender check. `ipcMain.on` channels (one-way messages) must not
 * throw at the sender, so they use this and silently drop the message.
 *
 * @param {object} event Electron IPC event
 * @returns {boolean} true when the sender is one of this app's windows
 */
/**
 * The only page URLs any KimFlow window may load or navigate to.
 *
 * Production loads the three entries over file://; the dev server serves the
 * renderer and overlay from localhost:1420 (its HMR websocket needs ws://).
 */
function isAllowedPageUrl(url) {
  const value = String(url || '');
  if (/^file:.*\/(index|overlay|widget)\.html($|[?#])/i.test(value)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1):1420(\/|$|\?|#)/i.test(value)) return true;
  if (/^ws:\/\/(localhost|127\.0\.0\.1):1420(\/|$|\?|#)/i.test(value)) return true;
  return false;
}

/**
 * Deny all navigation and window.open on a KimFlow window (#03 / W2).
 *
 * The three pages are loaded once by us; a renderer that ends up somewhere
 * else is compromised or broken, and in either case must not be able to
 * pull content — or open new windows with our preload attached.
 */
function hardenWindow(win, label) {
  if (!win || !win.webContents) return;
  const wc = win.webContents;
  try {
    if (typeof wc.on === 'function') {
      wc.on('will-navigate', (event, url) => {
        if (isAllowedPageUrl(url)) return;
        console.error(`[KimFlow] Blocked navigation on ${label}: ${String(url).slice(0, 120)}`);
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
      });
    }
  } catch { /* stub environments */ }
  try {
    if (typeof wc.setWindowOpenHandler === 'function') {
      wc.setWindowOpenHandler(({ url }) => {
        console.error(`[KimFlow] Blocked window.open on ${label}: ${String(url).slice(0, 120)}`);
        return { action: 'deny' };
      });
    }
  } catch { /* older Electron or stub environments */ }
}

function isTrustedSender(event) {
  const senderId = event && event.sender ? event.sender.id : undefined;
  if (senderId === undefined) return false;
  const trustedWindow = [mainWindow, overlayWindow]
    .filter(Boolean)
    .find((window) => window.webContents && window.webContents.id === senderId);
  if (!trustedWindow) return false;
  // Defence in depth (#03): a webContents whose URL is no longer one of our
  // pages (e.g. it navigated away) is NOT trusted, even with a matching id.
  // Sandboxed preloads are re-granted per navigation, so a navigated page
  // could otherwise hold a full-capability bridge.
  try {
    if (typeof event.sender.getURL === 'function') {
      const url = event.sender.getURL();
      if (url && !isAllowedPageUrl(url)) return false;
    }
  } catch { /* a destroyed sender cannot be trusted, but the id check above already covers it */ }
  return true;
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error('Unauthorized IPC sender');
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('get-settings', (event) => {
    assertTrustedSender(event);
    // Resolve a never-chosen UI language before the renderer sees it, so the
    // renderer always receives a concrete value. Secret fields are blanked so
    // they never leave the main process.
    return blankSecretValues(ensureUiLanguage(loadSettings()));
  });
  // `async` so a failure is always a rejected promise, exactly as Electron
  // reports it to the renderer.
  ipcMain.handle('save-settings', async (event, settings) => {
    assertTrustedSender(event);
    const candidate = normalizeSettings(settings);
    // A capture hotkey owned by another application must not block the rest
    // of the settings from being saved — otherwise the user cannot save their
    // API key either, and the app becomes unconfigurable. The hotkey is
    // reported separately below.
    const requestedHotkey = candidate.hotkey;
    const applied = isValidHotkey(requestedHotkey) && registerHotkeys(requestedHotkey);
    if (!applied) {
      // Keep the hotkey that is actually working, so the app stays usable.
      candidate.hotkey = getActiveHotkey() || requestedHotkey;
    }
    const saved = saveSettings(candidate);
    const safe = blankSecretValues(saved);
    sendToWindows('settings-updated', safe);
    // Pre-resolve the Gemini model so the next stop skips discovery.
    if (saved.translationEnabled) {
      void require('./backend/translation.service.cjs').warmup({
        apiKey: saved.geminiApiKey || getSecret('geminiApiKey'),
        model: saved.geminiModel || undefined,
        provider: saved.translationProvider,
      });
    }
    if (!applied) {
      // The settings ARE saved. The hotkey is reported separately, because
      // the saved value can equal the requested one when there was no working
      // hotkey to fall back to — the renderer could not tell them apart.
      const error = new Error('Capture hotkey could not be applied - another application may already use it, or it may be invalid. Your other settings were saved.');
      // A bare key without modifiers is the most conflict-prone choice: it
      // intercepts the key in every application (F2 = Explorer rename, for
      // instance). Kept inline (not from hotkeys.cjs) because the test
      // harness stubs this module with a minimal surface.
      const requestedParts = String(requestedHotkey || '').split('+');
      const bareNote = requestedParts.length === 1 && /^[a-z0-9]$|^f(?:[1-9]|1[0-2])$/i.test(requestedParts[0])
        ? ' Note: a bare key without modifiers is especially likely to be owned by another application - a combination like Ctrl+Alt+key is less conflict-prone.'
        : '';
      error.details = `Requested: ${requestedHotkey}. In effect: ${saved.hotkey}.${bareNote}`;
      throw error;
    }
    return safe;
  });
  // Device enumeration happens in the renderer because mediaDevices belongs to
  // the browser context. Keep this channel for backwards compatibility, but do
  // not pretend that the main process can enumerate renderer input devices.
  ipcMain.handle('list-microphones', (event) => {
    assertTrustedSender(event);
    return [];
  });
  ipcMain.handle('list-translation-languages', (event) => {
    assertTrustedSender(event);
    const { inputLanguages, targetLanguages } = require('./backend/languages.cjs');
    return { input: inputLanguages(), target: targetLanguages() };
  });
  ipcMain.handle('validate-gemini-model', async (event, model) => {
    assertTrustedSender(event);
    if (typeof model !== 'string') throw new Error('Gemini model must be a string');
    const gemini = require('./backend/gemini.cjs');
    const settings = loadSettings();
    return gemini.validateModel(settings.geminiApiKey || getSecret('geminiApiKey'), model);
  });
  ipcMain.handle('write-clipboard', (event, text) => {
    assertTrustedSender(event);
    if (typeof text !== 'string') throw new Error('Clipboard text must be a string');
    clipboard.writeText(text);
    return true;
  });
  ipcMain.handle('window-control', (event, action) => {
    assertTrustedSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Main window is unavailable');
    switch (action) {
      case 'minimize':
        mainWindow.minimize();
        break;
      case 'toggle-maximize':
        if (mainWindow.isMaximized()) mainWindow.unmaximize();
        else mainWindow.maximize();
        break;
      case 'close':
        mainWindow.close();
        break;
      default:
        throw new Error(`Unknown window control: ${action}`);
    }
  });
  ipcMain.handle('get-history', (event) => {
    assertTrustedSender(event);
    return history.load();
  });
  ipcMain.handle('clear-history', (event) => {
    assertTrustedSender(event);
    const cleared = history.clear();
    sendToWindows('history-updated', cleared);
    return cleared;
  });
  ipcMain.handle('get-recording-state', (event) => {
    assertTrustedSender(event);
    return getState();
  });
  ipcMain.handle('check-model-downloaded', (event, modelSize) => {
    assertTrustedSender(event);
    return require('./backend/transcribe.cjs').modelDownloaded(modelSize);
  });
  ipcMain.handle('download-model', async (event, modelSize) => {
    assertTrustedSender(event);
    return require('./backend/transcribe.cjs').downloadModel(mainWindow, modelSize);
  });
  const engineDownloadState = new Set();

  ipcMain.handle('download-engine', async (event, flavor) => {
    assertTrustedSender(event);
    const { validateFlavor } = require('./backend/engine-manifest.cjs');
    validateFlavor(flavor);
    if (process.platform !== 'win32') throw new Error('Engine downloads are Windows-only in this version');
    if (engineDownloadState.has(flavor)) throw new Error('That engine is already downloading');
    engineDownloadState.add(flavor);
    try {
      const engine = require('./backend/engine-download.cjs');
      let exePath;
      if (engine.engineInstalled(flavor)) {
        // Already on disk: re-verify it still runs, then just switch to it.
        // Clicking "Use X" must never re-download hundreds of megabytes.
        exePath = engine.engineBinaryPath(flavor);
      } else {
        const zipPath = await engine.downloadEngineZip(mainWindow, flavor);
        try {
          exePath = await engine.extractEngineZip(zipPath, flavor);
        } finally {
          try { fs.unlinkSync(zipPath); } catch { /* temp cleanup */ }
        }
      }
      await engine.smokeTestEngine(exePath).catch((smokeError) => {
        // A build that cannot start on this machine stays installed but is
        // marked incompatible, so the UI shows it honestly instead of
        // deleting it and looping the same failure on every click.
        engine.markEngineIncompatible(flavor, smokeError instanceof Error ? smokeError.message : String(smokeError));
        throw smokeError;
      });
      engine.clearEngineIncompatible(flavor);
      const settings = loadSettings();
      settings.whisperBinaryPath = exePath;
      knownBinaryPaths.add(exePath);
      const saved = saveSettings(settings);
      sendToWindows('settings-updated', blankSecretValues(saved));
      return exePath;
    } finally {
      engineDownloadState.delete(flavor);
    }
  });
  ipcMain.handle('engine-status', (event) => {
    assertTrustedSender(event);
    const engine = require('./backend/engine-download.cjs');
    const { ENGINE_FLAVORS } = require('./backend/engine-manifest.cjs');
    const status = {};
    for (const flavor of ENGINE_FLAVORS) {
      status[flavor] = engineDownloadState.has(flavor)
        ? 'downloading'
        : engine.engineState(flavor);
    }
    return status;
  });
  ipcMain.handle('activate-engine', (event, flavor) => {
    // Explicit user override: switch to an installed engine without
    // re-proving it (used for builds marked incompatible on this PC).
    assertTrustedSender(event);
    const { validateFlavor } = require('./backend/engine-manifest.cjs');
    validateFlavor(flavor);
    if (process.platform !== 'win32') throw new Error('Engine downloads are Windows-only in this version');
    const engine = require('./backend/engine-download.cjs');
    if (!engine.engineInstalled(flavor)) throw new Error('That engine is not downloaded');
    const exePath = engine.engineBinaryPath(flavor);
    const settings = loadSettings();
    settings.whisperBinaryPath = exePath;
    knownBinaryPaths.add(exePath);
    const saved = saveSettings(settings);
    sendToWindows('settings-updated', blankSecretValues(saved));
    return exePath;
  });
  ipcMain.handle('detect-gpu', async (event) => {
    assertTrustedSender(event);
    return require('./backend/engine-download.cjs').detectGpu();
  });
  ipcMain.handle('start-recording', async (event) => {
    assertTrustedSender(event);
    await startRecording(withTrustedBinaryPath(loadSettings()), [mainWindow, overlayWindow]);
  });

  ipcMain.handle('stop-recording', async (event, audioBuffer) => {
    assertTrustedSender(event);
    // Electron's structured-clone transport can deliver an ArrayBuffer,
    // Uint8Array, or Buffer depending on the Electron version. Normalize all
    // supported forms without losing a typed-array byte offset.
    if (!(audioBuffer instanceof ArrayBuffer) && !ArrayBuffer.isView(audioBuffer)
      && !Buffer.isBuffer(audioBuffer)) {
      throw new Error('A WAV audio buffer is required to stop recording');
    }
    // Measure before copying: a 10-minute 16 kHz mono WAV is under 20 MB, so
    // anything far beyond that is rejected instead of exhausting memory.
    if (audioByteLength(audioBuffer) > MAX_STOP_AUDIO_BYTES) {
      throw new Error('Audio is too large to process');
    }
    const buffer = Buffer.isBuffer(audioBuffer)
      ? Buffer.from(audioBuffer)
      : audioBuffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(audioBuffer))
        : Buffer.from(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
    const result = await stopRecording(withTrustedBinaryPath(loadSettings()), [mainWindow, overlayWindow], buffer);
    if (result && !result.aborted) sendToWindows('transcription-result', result);
    return result;
  });

  ipcMain.handle('toggle-recording', async (event) => {
    assertTrustedSender(event);
    const settings = loadSettings();
    if (getState() === STATE.READY) {
      await startRecording(settings, [mainWindow, overlayWindow]);
      return 'recording';
    }
    if (getState() === STATE.RECORDING) {
      throw new Error('Audio must be supplied when stopping a renderer recording');
    }
    return '';
  });

  ipcMain.handle('pause-recording', async (event) => {
    assertTrustedSender(event);
    await pauseRecording([mainWindow, overlayWindow]);
  });
  ipcMain.handle('resume-recording', async (event) => {
    assertTrustedSender(event);
    await resumeRecording([mainWindow, overlayWindow]);
  });
  ipcMain.handle('cancel-recording', async (event) => {
    assertTrustedSender(event);
    await cancelRecording([mainWindow, overlayWindow]);
  });
  ipcMain.handle('select-whisper-binary', async (event) => {
    assertTrustedSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Whisper CLI Binary',
      filters: process.platform === 'win32'
        ? [{ name: 'Executables', extensions: ['exe', 'cmd'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'All Files', extensions: ['*'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths?.length) return null;
    rememberTrustedBinary(result.filePaths[0]);
    return result.filePaths[0];
  });
  ipcMain.handle('check-whisper-binary', async (event, binaryPath) => {
    assertTrustedSender(event);
    // Existence-oracle closed (#04): only paths main itself handed out are
    // checkable. A path selected in an earlier session must be re-selected.
    if (typeof binaryPath !== 'string' || !binaryPath) return false;
    if (!knownBinaryPaths.has(binaryPath)) return false;
    try {
      const stat = fs.statSync(binaryPath);
      return stat.isFile();
    } catch {
      return false;
    }
  });
  ipcMain.handle('test-deepgram-connection', async (event, apiKey) => {
    assertTrustedSender(event);
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('A Deepgram API key is required to test the connection');
    const { testDeepgramConnection } = require('./backend/transcribe.cjs');
    return testDeepgramConnection(apiKey);
  });
  ipcMain.handle('test-speechmatics-connection', async (event, apiKey) => {
    assertTrustedSender(event);
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('A Speechmatics API key is required to test the connection');
    const { testSpeechmaticsConnection } = require('./backend/transcribe.cjs');
    return testSpeechmaticsConnection(apiKey);
  });
  ipcMain.handle('has-secret', (event, name) => {
    assertTrustedSender(event);
    const { hasSecret, SECRET_NAMES } = require('./backend/secrets.cjs');
    if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret: ${name}`);
    return hasSecret(name);
  });
  ipcMain.handle('secret-state', (event, name) => {
    assertTrustedSender(event);
    const { describeSecret, SECRET_NAMES } = require('./backend/secrets.cjs');
    if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret: ${name}`);
    return describeSecret(name);
  });
  ipcMain.handle('delete-secret', (event, name) => {
    assertTrustedSender(event);
    const { deleteSecret, SECRET_NAMES } = require('./backend/secrets.cjs');
    if (!SECRET_NAMES.includes(name)) throw new Error(`Unknown secret: ${name}`);
    deleteSecret(name);
    return true;
  });
  ipcMain.handle('overlay-action', async (event, action) => {
    assertTrustedSender(event);
    if (!['start', 'pause', 'resume', 'stop', 'cancel'].includes(action)) {
      throw new Error(`Unknown overlay action: ${action}`);
    }
    // The main renderer owns the microphone MediaRecorder and must perform the
    // audio operation before asking the backend to transcribe it.
    if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
      mainWindow.webContents.send('overlay-action', action);
    } else {
      pendingOverlayActions.push({ action, at: Date.now() });
      // Bounded queue: a flood of stale actions must not grow without limit.
      if (pendingOverlayActions.length > MAX_PENDING_OVERLAY_ACTIONS) {
        pendingOverlayActions.shift();
      }
    }
  });
  // Microphone level for the flow-bar widget's audio-reactive bars. The main
  // renderer taps the analyser it already owns and sends one number per frame
  // group; this only forwards it, and only while a recording is actually
  // running. One-way and non-throwing: a bad payload is dropped, never raised.
  //
  // The renderer decides to send from `settings.useFlowBarWidget`, which is the
  // stored config value; KIMFLOW_FLOWBAR=0 overrides that in this process only,
  // so the two can disagree. Dropping the message here is the correct boundary:
  // when the legacy overlay is the window that exists, `widget-level` would go
  // to a renderer with no listener at ~30 Hz for nothing. `flowBarEnabled` is
  // the value that chose the window, so it cannot be stale. Do not re-read
  // loadSettings() per message — that hits the disk 30 times a second.
  ipcMain.on('mic-level', (event, level) => {
    if (!flowBarEnabled) return;
    if (!isTrustedSender(event)) return;
    if (typeof level !== 'number' || !Number.isFinite(level)) return;
    if (getState() !== STATE.RECORDING) return;
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    if (overlayWindow.webContents?.isDestroyed?.() === true) return;
    const clamped = Math.min(1, Math.max(0, level));
    try {
      overlayWindow.webContents.send('widget-level', clamped);
    } catch {
      // Window died mid-send; the next frame reconnects.
    }
  });
}

/**
 * Blank a whisper binary path the main process never handed out (N4): the
 * value comes from a renderer-writable settings field, and local-whisper
 * uses it as the FIRST execFile candidate — an unvetted path would let a
 * compromised renderer execute an arbitrary native binary.
 */
function withTrustedBinaryPath(settings) {
  if (settings && settings.whisperBinaryPath && !knownBinaryPaths.has(settings.whisperBinaryPath)) {
    console.error('[KimFlow] Ignoring unrecognised whisper binary path (not selected in this session)');
    settings.whisperBinaryPath = '';
  }
  return settings;
}

app.whenReady().then(() => {
  // Mirror console output into a file BEFORE anything can fail: the packaged
  // app has no terminal, so crash-recovery and engine diagnostics were
  // invisible. Failures here degrade to console-only, never break startup.
  try {
    require('./backend/logging.cjs').installFileLogging(path.join(app.getPath('userData'), 'logs'));
  } catch { /* logging must never break startup */ }

  // Secret storage must be relocated BEFORE any settings load or IPC can
  // touch a secret. Electron's safeStorage blobs decrypt with the AES key in
  // the app's `Local State` inside userData, so the blobs must live there
  // too — otherwise a dev/installed/legacy context change makes every saved
  // key permanently undecryptable. A failure here must never break startup:
  // the module falls back to the legacy ~/.kimflow location.
  try {
    const userDataDir = app.getPath('userData');
    setSecretsDir(userDataDir);
    // One-time copy of blobs written by older versions out of ~/.kimflow.
    // Copies, never moves, so a rollback to an older build still finds them.
    migrateSecrets(CONFIG_DIR, userDataDir);
  } catch (error) {
    console.error('[KimFlow] Secret storage relocation failed; using the legacy ~/.kimflow location:', error instanceof Error ? error.message : error);
  }

  // Crash-recovery sweep: a hard crash (or forced kill) between WAV write and
  // cleanup used to leave raw dictated audio in ~/.kimflow forever — two real
  // orphans from August were found on disk (N7). No recording can be in
  // flight at startup, so every leftover temp WAV is safe to remove.
  try {
    for (const entry of fs.readdirSync(CONFIG_DIR)) {
      if (/^temp_recording_.+\.wav$/i.test(entry)) {
        try {
          fs.unlinkSync(path.join(CONFIG_DIR, entry));
          console.error(`[KimFlow] Removed stale temp recording left by a previous session: ${entry}`);
        } catch { /* best-effort */ }
      }
    }
  } catch { /* no config dir yet */ }

  // A managed-engine path persisted by an earlier session stays trusted; a
  // dialog-selected path survives restart through the main-owned
  // trusted-binaries file (config.json is renderer-writable and is NOT a
  // trust source). Runs AFTER the relocation: loadSettings() can hit the
  // plaintext-key migration, which must write to the relocated secret store,
  // not the legacy one.
  try {
    trustedBinariesFile = path.join(app.getPath('userData'), 'trusted-binaries.json');
    let persisted = [];
    try { persisted = JSON.parse(fs.readFileSync(trustedBinariesFile, 'utf8')); } catch { /* first run */ }
    if (Array.isArray(persisted)) for (const entry of persisted) knownBinaryPaths.add(entry);
  } catch { /* userData unavailable in stripped test environments */ }

  // Pause the widget's 16 ms poll while the machine sleeps or locks (W5):
  // 62 wakeups per second against a locked session waste battery, and a
  // stale cursor reading can leave the whole window click-blocking.
  try {
    const { powerMonitor } = require('electron');
    if (powerMonitor && typeof powerMonitor.on === 'function') {
      powerMonitor.on('suspend', suspendWidgetPoll);
      powerMonitor.on('lock-screen', suspendWidgetPoll);
      powerMonitor.on('resume', resumeWidgetPoll);
      powerMonitor.on('unlock-screen', resumeWidgetPoll);
    }
  } catch { /* powerMonitor unavailable in this environment */ }
  try {
    const configured = loadSettings().whisperBinaryPath;
    if (configured) {
      const { ENGINE_FLAVORS } = require('./backend/engine-manifest.cjs');
      const engine = require('./backend/engine-download.cjs');
      for (const flavor of ENGINE_FLAVORS || []) {
        try {
          if (engine.engineBinaryPath(flavor) === configured) knownBinaryPaths.add(configured);
        } catch { /* flavor without a path */ }
      }
    }
  } catch { /* engine modules unavailable in stripped test environments */ }

  const isTrustedMediaOrigin = (webContents) => {
    const url = webContents.getURL();
    return url.startsWith('file://')
      || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//.test(url);
  };

  // Electron does not automatically grant getUserMedia access to every
  // BrowserWindow. Explicitly approve microphone requests from this app's
  // local renderer, while denying requests from unexpected origins.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media' && isTrustedMediaOrigin(webContents));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' && isTrustedMediaOrigin(webContents);
  });

  registerIpc();
  Menu.setApplicationMenu(null);
  createWindows();

  const settings = ensureUiLanguage(loadSettings());
  setHotkeyCallbacks(() => requestRendererHotkey(true));
  const startupHotkey = settings.hotkey || 'CmdOrCtrl+Shift+Space';
  if (!registerHotkeys(startupHotkey)) {
    // A taken hotkey previously failed silently: buttons worked but the
    // shortcut was dead with no indication. Say so once, up front.
    console.error(`[KimFlow] Capture hotkey "${startupHotkey}" is already in use; change it in Settings.`);
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        void dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['OK'],
          defaultId: 0,
          title: APP_NAME,
          message: `Capture hotkey "${startupHotkey}" is already in use by another application. Recording buttons still work — pick a free hotkey in Settings.`,
        });
      }
    } catch { /* startup warning is best-effort */ }
  }
  if (settings.translationEnabled) {
    void require('./backend/translation.service.cjs').warmup({
      apiKey: settings.geminiApiKey || getSecret('geminiApiKey'),
      model: settings.geminiModel || undefined,
      provider: settings.translationProvider,
    });
  }
});

app.on('will-quit', () => {
  unregisterHotkeys();
  destroyOverlayWindow();
  shutdownPasteHelper();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
