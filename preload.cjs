const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const fullApi = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getLanguages: () => ipcRenderer.invoke('list-translation-languages'),
  validateGeminiModel: (model) => ipcRenderer.invoke('validate-gemini-model', model),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
  checkModelDownloaded: (modelSize) => ipcRenderer.invoke('check-model-downloaded', modelSize),
  downloadModel: (modelSize) => ipcRenderer.invoke('download-model', modelSize),
  downloadEngine: (flavor) => ipcRenderer.invoke('download-engine', flavor),
  activateEngine: (flavor) => ipcRenderer.invoke('activate-engine', flavor),
  engineStatus: () => ipcRenderer.invoke('engine-status'),
  detectGpu: () => ipcRenderer.invoke('detect-gpu'),
  selectWhisperBinary: () => ipcRenderer.invoke('select-whisper-binary'),
  checkWhisperBinary: (binaryPath) => ipcRenderer.invoke('check-whisper-binary', binaryPath),
  testDeepgramConnection: (apiKey) => ipcRenderer.invoke('test-deepgram-connection', apiKey),
  testSpeechmaticsConnection: (apiKey) => ipcRenderer.invoke('test-speechmatics-connection', apiKey),
  hasSecret: (name) => ipcRenderer.invoke('has-secret', name),
  secretState: (name) => ipcRenderer.invoke('secret-state', name),
  deleteSecret: (name) => ipcRenderer.invoke('delete-secret', name),
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: (audioBuffer) => ipcRenderer.invoke('stop-recording', audioBuffer),
  cancelRecording: () => ipcRenderer.invoke('cancel-recording'),
  pauseRecording: () => ipcRenderer.invoke('pause-recording'),
  resumeRecording: () => ipcRenderer.invoke('resume-recording'),
  // Microphone level tap for the flow-bar widget. The main renderer owns the
  // analyser and sends ~30 values per second while recording.
  sendMicLevel: (level) => ipcRenderer.send('mic-level', level),
  overlayAction: (action) => ipcRenderer.invoke('overlay-action', action),
  copyText: (text) => ipcRenderer.invoke('write-clipboard', text),
  windowControl: (action) => ipcRenderer.invoke('window-control', action),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  onHotkeyPressed: (callback) => subscribe('hotkey-pressed', callback),
  onRecordingState: (callback) => subscribe('recording-state', callback),
  onRecordingTimeLimit: (callback) => subscribe('recording-time-limit', callback),
  onTranscriptionResult: (callback) => subscribe('transcription-result', callback),
  onDownloadProgress: (callback) => subscribe('download-progress', callback),
  onOverlayAction: (callback) => subscribe('overlay-action', callback),
  onSettingsUpdated: (callback) => subscribe('settings-updated', callback),
  onHistoryUpdated: (callback) => subscribe('history-updated', callback),
};

// The floating widget only drives recording and mirrors state/accent color.
// Everything that mutates data or touches secrets stays in the main window.
// getSettings is read-only (key fields are blanked by design) and the widget
// uses it solely for the accent color.
const overlayApi = {
  overlayAction: fullApi.overlayAction,
  getRecordingState: fullApi.getRecordingState,
  getSettings: fullApi.getSettings,
  onRecordingState: fullApi.onRecordingState,
  onSettingsUpdated: fullApi.onSettingsUpdated,
};

// The path of the page this preload was injected into, WITHOUT its query
// string or hash.
//
// `location.pathname` is the right property. The href fallback exists because a
// test sandbox (and any context that only exposes href) may not provide it, and
// it strips `?`/`#` itself. What matters is that the query string can never
// decide which bridge a page gets: the widget's own documented dev hook is
// `widget.html?debug=listening`, and matching on the raw href would hand that
// restricted window the full main-window API — saveSettings, deleteSecret,
// startRecording — instead of its six-key surface.
function pagePath() {
  const location = window.location;
  if (location && typeof location.pathname === 'string' && location.pathname) {
    return location.pathname;
  }
  const href = location && typeof location.href === 'string' ? location.href : '';
  return href.split('?')[0].split('#')[0];
}

function isOverlayPage() {
  try {
    return /overlay\.html?$/i.test(pagePath());
  } catch {
    return false;
  }
}

// The flow-bar widget replaces the overlay as the floating UI. Same restricted
// surface plus the microphone level feed, which only the widget consumes.
const widgetApi = {
  overlayAction: fullApi.overlayAction,
  getRecordingState: fullApi.getRecordingState,
  getSettings: fullApi.getSettings,
  onRecordingState: fullApi.onRecordingState,
  onSettingsUpdated: fullApi.onSettingsUpdated,
  onMicLevel: (callback) => subscribe('widget-level', callback),
};

function isWidgetPage() {
  try {
    return /\/widget\.html?$/i.test(pagePath());
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld('api', isWidgetPage() ? widgetApi : isOverlayPage() ? overlayApi : fullApi);
