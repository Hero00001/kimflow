const { app, BrowserWindow, ipcMain, session, Menu, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');

const { registerHotkeys, unregisterHotkeys, setHotkeyCallbacks, isValidHotkey } = require('./backend/hotkeys.cjs');
const {
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  cancelRecording,
  getState,
  STATE,
} = require('./backend/recorder.cjs');
const { loadSettings, saveSettings, normalizeSettings } = require('./backend/settings.cjs');
const history = require('./backend/history.cjs');

let mainWindow;
let overlayWindow;
let ipcRegistered = false;
let rendererReady = false;
let pendingHotkey = null;
let pendingOverlayActions = [];
const APP_NAME = 'KimFlow';
const ICON_PATH = path.join(__dirname, 'app icon', 'icon.ico');
app.setName(APP_NAME);

function sendToWindows(channel, value) {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, value);
  }
}

function isDevelopment() {
  return Boolean(process.env.ELECTRON_DEV_HOST) || !app.isPackaged;
}

function getRendererEntry() {
  const devHost = process.env.ELECTRON_DEV_HOST || 'localhost';
  const builtIndex = path.join(__dirname, 'dist', 'index.html');
  if (process.argv.includes('--dev') || process.env.ELECTRON_DEV_HOST) {
    return { type: 'url', value: `http://${devHost}:1420` };
  }
  if (isDevelopment() && !fs.existsSync(builtIndex)) return { type: 'url', value: `http://${devHost}:1420` };
  return { type: 'file', value: builtIndex };
}

function getOverlayEntry() {
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

  overlayWindow = new BrowserWindow({
    width: 240,
    height: 92,
    minWidth: 200,
    minHeight: 78,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    transparent: true,
    show: true,
    title: APP_NAME,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // The overlay owns its controls, so it must receive mouse input. Its
  // controls can be moved with the frameless window drag region.
  overlayWindow.setIgnoreMouseEvents(false);
  loadEntry(overlayWindow, getOverlayEntry()).catch((error) => {
    console.error('[KimFlow] Failed to load overlay window:', error);
  });

  mainWindow.on('closed', () => {
    rendererReady = false;
    void cancelRecording([mainWindow, overlayWindow]);
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

function assertTrustedSender(event) {
  const senderId = event.sender.id;
  const trusted = [mainWindow, overlayWindow]
    .filter(Boolean)
    .some((window) => window.webContents.id === senderId);
  if (!trusted) throw new Error('Unauthorized IPC sender');
}

function registerIpc() {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('get-settings', (event) => {
    assertTrustedSender(event);
    return loadSettings();
  });
  ipcMain.handle('save-settings', (event, settings) => {
    assertTrustedSender(event);
    const candidate = normalizeSettings(settings);
    if (!isValidHotkey(candidate.hotkey) || !registerHotkeys(candidate.hotkey)) {
      throw new Error(`Unable to register capture hotkey: ${candidate.hotkey}`);
    }
    const saved = saveSettings(candidate);
    sendToWindows('settings-updated', saved);
    return saved;
  });
  // Device enumeration happens in the renderer because mediaDevices belongs to
  // the browser context. Keep this channel for backwards compatibility, but do
  // not pretend that the main process can enumerate renderer input devices.
  ipcMain.handle('list-microphones', (event) => {
    assertTrustedSender(event);
    return [];
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
    for (const window of [mainWindow, overlayWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send('history-updated', cleared);
    }
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
    const buffer = Buffer.isBuffer(audioBuffer)
      ? Buffer.from(audioBuffer)
      : audioBuffer instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(audioBuffer))
        : Buffer.from(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength);
    const result = await stopRecording(loadSettings(), [mainWindow, overlayWindow], buffer);
    if (result) sendToWindows('transcription-result', result);
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
}

app.whenReady().then(() => {
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

  const settings = loadSettings();
  setHotkeyCallbacks(
    () => requestRendererHotkey(true),
    () => requestRendererHotkey(false),
  );
  registerHotkeys(settings.hotkey || 'CmdOrCtrl+Shift+Space');
});

app.on('will-quit', () => {
  unregisterHotkeys();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
