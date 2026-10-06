const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const fullApi = {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  listMicrophones: () => ipcRenderer.invoke('list-microphones'),
  getLanguages: () => ipcRenderer.invoke('list-translation-languages'),
  validateGeminiModel: (model) => ipcRenderer.invoke('validate-gemini-model', model),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
  checkModelDownloaded: (modelSize) => ipcRenderer.invoke('check-model-downloaded', modelSize),
  downloadModel: (modelSize) => ipcRenderer.invoke('download-model', modelSize),
  selectWhisperBinary: () => ipcRenderer.invoke('select-whisper-binary'),
  checkWhisperBinary: (binaryPath) => ipcRenderer.invoke('check-whisper-binary', binaryPath),
  testDeepgramConnection: (apiKey) => ipcRenderer.invoke('test-deepgram-connection', apiKey),
  testSpeechmaticsConnection: (apiKey) => ipcRenderer.invoke('test-speechmatics-connection', apiKey),
  hasSecret: (name) => ipcRenderer.invoke('has-secret', name),
  secretState: (name) => ipcRenderer.invoke('secret-state', name),
  deleteSecret: (name) => ipcRenderer.invoke('delete-secret', name),
  toggleRecording: () => ipcRenderer.invoke('toggle-recording'),
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: (audioBuffer) => ipcRenderer.invoke('stop-recording', audioBuffer),
  cancelRecording: () => ipcRenderer.invoke('cancel-recording'),
  pauseRecording: () => ipcRenderer.invoke('pause-recording'),
  resumeRecording: () => ipcRenderer.invoke('resume-recording'),
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

function isOverlayPage() {
  try {
    return /overlay\.html?$/i.test(window.location.href);
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld('api', isOverlayPage() ? overlayApi : fullApi);
