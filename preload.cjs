const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  listMicrophones: () => ipcRenderer.invoke('list-microphones'),
  getRecordingState: () => ipcRenderer.invoke('get-recording-state'),
  checkModelDownloaded: (modelSize) => ipcRenderer.invoke('check-model-downloaded', modelSize),
  downloadModel: (modelSize) => ipcRenderer.invoke('download-model', modelSize),
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
  onTranscriptionResult: (callback) => subscribe('transcription-result', callback),
  onDownloadProgress: (callback) => subscribe('download-progress', callback),
  onOverlayAction: (callback) => subscribe('overlay-action', callback),
  onSettingsUpdated: (callback) => subscribe('settings-updated', callback),
  onHistoryUpdated: (callback) => subscribe('history-updated', callback),
});
