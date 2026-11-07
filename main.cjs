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
const { createWidgetWindow, destroyWidgetWindow } = require('./backend/widget-window.cjs');
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
let pendingOverlayActions = [];
const APP_NAME = 'KimFlow';
// UI languages the renderer can display. Kept in sync with
// backend/settings.cjs's UI_LANGUAGES and src/i18n's UILanguage union.
const UI_LANGUAGES = ['en', 'ar', 'zh'];
// 10 minutes of 16 kHz mono 16-bit WAV is under 20 MB; anything far beyond
// that is a malformed or abusive payload, rejected before Buffer allocation.
const MAX_STOP_AUDIO_BYTES = 64 * 1024 * 1024;
const ICON_PATH = path.join(__dirname, 'app icon', 'icon.ico');
app.setName(APP_NAME);

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
    },
  });

  if (!isMac) {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);
  }

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
    for (const action of pendingOverlayActions.splice(0)) {
      mainWindow.webContents.send('overlay-action', action);
    }
  });
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false;
    void cancelRecording([mainWindow, overlayWindow]);
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
    loadEntry(overlayWindow, getOverlayEntry()).catch((error) => {
      console.error('[KimFlow] Failed to load overlay window:', error);
    });
  }

  mainWindow.on('closed', () => {
    rendererReady = false;
    void cancelRecording([mainWindow, overlayWindow]);
    destroyOverlayWindow();
    mainWindow = null;
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
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
function isTrustedSender(event) {
  const senderId = event && event.sender ? event.sender.id : undefined;
  if (senderId === undefined) return false;
  return [mainWindow, overlayWindow]
    .filter(Boolean)
    .some((window) => window.webContents && window.webContents.id === senderId);
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
    await startRecording(loadSettings(), [mainWindow, overlayWindow]);
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
    const result = await stopRecording(loadSettings(), [mainWindow, overlayWindow], buffer);
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
    return result.filePaths[0];
  });
  ipcMain.handle('check-whisper-binary', async (event, binaryPath) => {
    assertTrustedSender(event);
    if (typeof binaryPath !== 'string' || !binaryPath) return false;
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
      pendingOverlayActions.push(action);
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

app.whenReady().then(() => {
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
