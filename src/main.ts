interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

let currentSettings: Settings;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let recordingChunks: Blob[] = [];
let currentState = 'ready';
let isToggling = false;

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const statusError = document.getElementById('status-error')!;
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const recordIconMic = document.getElementById('record-icon-mic')!;
const recordIconStop = document.getElementById('record-icon-stop')!;
const hotkeyDisplay = document.getElementById('hotkey-display')!;
const transcriptArea = document.getElementById('transcript-area')!;
const transcriptText = document.getElementById('transcript-text')!;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const micSelect = document.getElementById('mic-select') as HTMLSelectElement;
const engineGroup = document.getElementById('engine-group')!;
const localRow = document.getElementById('local-row')!;
const groqRow = document.getElementById('groq-row')!;
const deepgramRow = document.getElementById('deepgram-row')!;
const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
const downloadProgress = document.getElementById('download-progress')!;
const progressFill = document.getElementById('progress-fill')!;
const groqKey = document.getElementById('groq-key') as HTMLInputElement;
const deepgramKey = document.getElementById('deepgram-key') as HTMLInputElement;
const modeGroup = document.getElementById('mode-group')!;
const hotkeyText = document.getElementById('hotkey-text')!;
const hotkeyInput = document.getElementById('hotkey-input') as HTMLInputElement;
const hotkeyRecord = document.getElementById('hotkey-record') as HTMLButtonElement;
const accentColor = document.getElementById('accent-color') as HTMLInputElement;
let recordingHotkey = false;

const STATES = {
  READY: 'ready',
  RECORDING: 'recording',
  PAUSED: 'paused',
  TRANSCRIBING: 'transcribing',
} as const;

function setState(state: string) {
  currentState = state;
  recordBtn.classList.remove('recording', 'transcribing');
  recordIconMic.style.display = 'flex';
  recordIconStop.style.display = 'none';
  statusDot.className = '';
  statusError.classList.add('hidden');

  if (state === STATES.RECORDING) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('recording');
    statusText.textContent = 'Recording...';
  } else if (state === STATES.PAUSED) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('transcribing');
    statusText.textContent = 'Paused';
  } else if (state === STATES.TRANSCRIBING) {
    recordBtn.classList.add('transcribing');
    statusDot.classList.add('transcribing');
    statusText.textContent = 'Transcribing...';
  } else {
    statusDot.classList.add('ready');
    statusText.textContent = 'Ready';
  }

  recordBtn.disabled = state === STATES.TRANSCRIBING;
  recordBtn.setAttribute('aria-label', state === STATES.RECORDING ? 'Stop Recording' : 'Start Recording');
}

function showError(message: string) {
  statusError.textContent = message;
  statusError.classList.remove('hidden');
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function populateMics() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('Microphone device enumeration is unavailable');
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((device) => device.kind === 'audioinput');
    micSelect.replaceChildren();
    for (const device of audioInputs) {
      const option = document.createElement('option');
      option.value = device.deviceId || 'default';
      option.textContent = device.label || `Microphone ${device.deviceId.slice(0, 8)}`;
      micSelect.appendChild(option);
    }
    if (!micSelect.options.length) {
      micSelect.append(new Option('Default Microphone', 'default'));
    }
    if ([...micSelect.options].some((option) => option.value === currentSettings.microphone)) {
      micSelect.value = currentSettings.microphone;
    }
  } catch {
    micSelect.replaceChildren(new Option('Default Microphone', 'default'));
  }
}

async function requestAudioStream() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is unavailable in this window');
  }
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
  };
  if (currentSettings.microphone && currentSettings.microphone !== 'default') {
    audio.deviceId = { exact: currentSettings.microphone };
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (error) {
    // A stale device ID should not prevent use of the default microphone.
    if (audio.deviceId) {
      delete audio.deviceId;
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio });
    } else {
      throw error;
    }
  }
  await populateMics();
}

function stopTracks() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

function pauseAudioCapture() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') throw new Error('Audio recording is not active');
  mediaRecorder.pause();
}

function resumeAudioCapture() {
  if (!mediaRecorder || mediaRecorder.state !== 'paused') throw new Error('Audio recording is not paused');
  mediaRecorder.resume();
}

function abortAudioCapture() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.ondataavailable = null;
    mediaRecorder.onerror = null;
    mediaRecorder.onstop = null;
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  recordingChunks = [];
  stopTracks();
}

async function startAudioCapture() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('This system does not support microphone recording');
  }
  await requestAudioStream();
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  recordingChunks = [];
  mediaRecorder = new MediaRecorder(mediaStream!, { mimeType });
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) recordingChunks.push(event.data);
  };
  mediaRecorder.start();
}

async function stopAudioCapture(): Promise<ArrayBuffer> {
  const recorder = mediaRecorder;
  if (!recorder) throw new Error('Audio recording is not active');

  const webm = await new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(recordingChunks, { type: recorder.mimeType }));
    recorder.onerror = () => reject(new Error('Microphone recording failed'));
    if (recorder.state !== 'inactive') recorder.stop();
    else resolve(new Blob(recordingChunks, { type: recorder.mimeType }));
  });

  mediaRecorder = null;
  stopTracks();
  recordingChunks = [];
  try {
    return await encodeWav(webm);
  } catch (error) {
    throw new Error(`Unable to decode microphone audio: ${errorMessage(error, 'unsupported audio format')}`);
  }
}

async function encodeWav(blob: Blob): Promise<ArrayBuffer> {
  const source = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    const decoded = await audioContext.decodeAudioData(source.slice(0));
    const targetRate = 16000;
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetRate));
    const offline = new OfflineAudioContext(1, frameCount, targetRate);
    const sourceNode = offline.createBufferSource();
    sourceNode.buffer = decoded;
    sourceNode.connect(offline.destination);
    sourceNode.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0);
    const wav = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(wav);
    const writeString = (offset: number, value: string) => {
      for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetRate, true);
    view.setUint32(28, targetRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return wav;
  } finally {
    await audioContext.close();
  }
}

async function beginRecording() {
  if (!currentSettings || currentState !== STATES.READY || isToggling) return;
  isToggling = true;
  try {
    await startAudioCapture();
    await window.api.startRecording();
    setState(STATES.RECORDING);
  } catch (error) {
    abortAudioCapture();
    await window.api.cancelRecording().catch(() => undefined);
    setState(STATES.READY);
    showError(errorMessage(error, 'Unable to start recording'));
  } finally {
    isToggling = false;
  }
}

async function finishRecording() {
  if ((currentState !== STATES.RECORDING && currentState !== STATES.PAUSED) || isToggling) return;
  isToggling = true;
  setState(STATES.TRANSCRIBING);
  try {
    const wav = await stopAudioCapture();
    const result = await window.api.stopRecording(wav);
    if (result) showTranscript(result);
  } catch (error) {
    abortAudioCapture();
    await window.api.cancelRecording().catch(() => undefined);
    setState(STATES.READY);
    showError(errorMessage(error, 'Transcription failed'));
  } finally {
    isToggling = false;
  }
}

async function handleTrigger(pressed: boolean) {
  const mode = currentSettings?.recordingMode || 'toggle';
  if (mode === 'push-to-talk') {
    // Electron globalShortcut exposes key presses but not releases. The on-screen
    // button remains true push-to-talk; the global shortcut safely toggles instead
    // of leaving a recording stuck forever.
    if (pressed) {
      if (currentState === STATES.READY) await beginRecording();
      else if (currentState === STATES.RECORDING) await finishRecording();
    } else {
      await finishRecording();
    }
  } else if (pressed) {
    if (currentState === STATES.READY) await beginRecording();
    else if (currentState === STATES.RECORDING) await finishRecording();
  }
}

recordBtn.addEventListener('click', () => {
  if (currentSettings?.recordingMode === 'toggle') void handleTrigger(true);
});
recordBtn.addEventListener('pointerdown', (event) => {
  if (currentSettings?.recordingMode === 'push-to-talk') {
    event.preventDefault();
    void handleTrigger(true);
  }
});
recordBtn.addEventListener('pointerup', (event) => {
  if (currentSettings?.recordingMode === 'push-to-talk') {
    event.preventDefault();
    void handleTrigger(false);
  }
});
recordBtn.addEventListener('pointerleave', () => {
  if (currentSettings?.recordingMode === 'push-to-talk') void handleTrigger(false);
});

function showTranscript(text: string) {
  transcriptArea.classList.remove('hidden');
  transcriptText.textContent = text;
}

copyBtn.addEventListener('click', async () => {
  const text = transcriptText.textContent || '';
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied!');
  } catch {
    showError('Unable to copy transcript');
  }
});

function showToast(message: string) {
  document.getElementById('copy-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.remove(), 1500);
}

function setEngine(engine: string) {
  if (!currentSettings) return;
  currentSettings.engine = engine;
  localRow.classList.toggle('hidden', engine !== 'local');
  groqRow.classList.toggle('hidden', engine !== 'groq');
  deepgramRow.classList.toggle('hidden', engine !== 'deepgram');
  engineGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === engine);
  });
}

engineGroup.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
  if (!button?.dataset.value) return;
  setEngine(button.dataset.value);
  void persist();
});

micSelect.addEventListener('change', () => { void persist(); });
modelSelect.addEventListener('change', () => { void checkModelStatus(); void persist(); });
groqKey.addEventListener('change', () => { void persist(); });
deepgramKey.addEventListener('change', () => { void persist(); });

async function pauseFromOverlay() {
  try {
    pauseAudioCapture();
    await window.api.pauseRecording();
  } catch (error) {
    if (mediaRecorder?.state === 'paused') mediaRecorder.resume();
    showError(errorMessage(error, 'Unable to pause recording'));
  }
}

async function resumeFromOverlay() {
  try {
    resumeAudioCapture();
    await window.api.resumeRecording();
  } catch (error) {
    if (mediaRecorder?.state === 'recording') mediaRecorder.pause();
    showError(errorMessage(error, 'Unable to resume recording'));
  }
}

async function cancelFromOverlay() {
  abortAudioCapture();
  try {
    await window.api.cancelRecording();
  } finally {
    setState(STATES.READY);
  }
}

accentColor.addEventListener('input', () => { void persist(); });
hotkeyInput.addEventListener('change', () => { void persist(); });
hotkeyRecord.addEventListener('click', () => {
  recordingHotkey = !recordingHotkey;
  hotkeyRecord.textContent = recordingHotkey ? 'Press keys…' : 'Record';
  hotkeyInput.classList.toggle('recording', recordingHotkey);
  if (recordingHotkey) hotkeyInput.focus();
});
hotkeyInput.addEventListener('keydown', (event) => {
  if (!recordingHotkey) return;
  event.preventDefault();
  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '', event.metaKey ? 'Command' : '',
    event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '',
  ].filter(Boolean);
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) {
    hotkeyInput.value = [...modifiers, key].join('+');
    recordingHotkey = false;
    hotkeyRecord.textContent = 'Record';
    hotkeyInput.classList.remove('recording');
    void persist();
  }
});

modeGroup.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
  if (!button?.dataset.mode || !currentSettings) return;
  currentSettings.recordingMode = button.dataset.mode;
  modeGroup.querySelectorAll('.toggle-btn').forEach((item) => {
    item.classList.toggle('active', (item as HTMLElement).dataset.mode === currentSettings.recordingMode);
  });
  void persist();
});

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function applyAccentColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-hover', color);
  document.documentElement.style.setProperty('--accent-subtle', hexToRgba(color, 0.12));
}

async function persist() {
  if (!currentSettings) return;
  currentSettings.microphone = micSelect.value || 'default';
  currentSettings.whisperModel = modelSelect.value;
  currentSettings.groqApiKey = groqKey.value;
  currentSettings.deepgramApiKey = deepgramKey.value;
  currentSettings.hotkey = hotkeyInput.value.trim() || currentSettings.hotkey;
  currentSettings.accentColor = accentColor.value;
  applyAccentColor(currentSettings.accentColor);
  try {
    currentSettings = await window.api.saveSettings(currentSettings);
  } catch (error) {
    showError(errorMessage(error, 'Unable to save settings'));
  }
}

async function checkModelStatus() {
  try {
    const downloaded = await window.api.checkModelDownloaded(modelSelect.value);
    downloadBtn.textContent = downloaded ? '✓' : 'Download';
    downloadBtn.disabled = downloaded;
  } catch (error) {
    downloadBtn.disabled = false;
    showError(errorMessage(error, 'Unable to check model'));
  }
}

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  downloadProgress.classList.remove('hidden');
  progressFill.style.width = '0%';
  try {
    await window.api.downloadModel(modelSelect.value);
    downloadBtn.textContent = '✓';
  } catch (error) {
    downloadBtn.textContent = 'Retry';
    downloadBtn.disabled = false;
    showError(errorMessage(error, 'Download failed'));
  } finally {
    downloadProgress.classList.add('hidden');
  }
});

function formatHotkey(hotkey: string) {
  const isWindows = /win/i.test(navigator.platform || navigator.userAgent);
  return hotkey.replace(/CmdOrCtrl|CommandOrControl/g, isWindows ? 'Ctrl' : 'Cmd');
}

async function init() {
  const unsubscribers = [
    window.api.onOverlayAction((action) => {
      if (action === 'start') void beginRecording();
      else if (action === 'pause') void pauseFromOverlay();
      else if (action === 'resume') void resumeFromOverlay();
      else if (action === 'stop') void finishRecording();
      else if (action === 'cancel') void cancelFromOverlay();
    }),
    window.api.onSettingsUpdated((settings) => {
      currentSettings = settings;
      accentColor.value = settings.accentColor;
      applyAccentColor(settings.accentColor);
      hotkeyInput.value = settings.hotkey;
      hotkeyText.textContent = formatHotkey(settings.hotkey);
      hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
    }),
    // Electron globalShortcut reports key-down, not key-up. Treat the global
    // shortcut as a safe toggle even when the UI is configured for push-to-talk;
    // the on-screen button still provides true press/release behavior.
    window.api.onHotkeyPressed((event) => {
      if (event.pressed) {
        void (currentState === STATES.READY ? beginRecording() : finishRecording());
      }
    }),
    window.api.onRecordingState((state) => setState(state)),
    window.api.onTranscriptionResult((result) => { if (result) showTranscript(result); }),
    window.api.onDownloadProgress((progress: DownloadProgress) => {
      progressFill.style.width = `${Math.max(0, Math.min(100, progress.percent))}%`;
    }),
  ];
  window.addEventListener('beforeunload', () => unsubscribers.forEach((unsubscribe) => unsubscribe()), { once: true });

  try {
    currentSettings = await window.api.getSettings();
    setEngine(currentSettings.engine);
    modelSelect.value = currentSettings.whisperModel;
    groqKey.value = currentSettings.groqApiKey || '';
    deepgramKey.value = currentSettings.deepgramApiKey || '';
    modeGroup.querySelectorAll('.toggle-btn').forEach((button) => {
      button.classList.toggle('active', (button as HTMLElement).dataset.mode === currentSettings.recordingMode);
    });
    hotkeyText.textContent = formatHotkey(currentSettings.hotkey);
    hotkeyInput.value = currentSettings.hotkey;
    hotkeyDisplay.textContent = formatHotkey(currentSettings.hotkey);
    accentColor.value = currentSettings.accentColor;
    applyAccentColor(currentSettings.accentColor);
    // Request permission once during setup so enumerateDevices returns usable
    // labels and stable device IDs for the selector. Tracks are stopped
    // immediately; recording requests a fresh stream later.
    if (!navigator.mediaDevices?.getUserMedia) {
      showError('Microphone access is unavailable in this Electron window');
    } else {
      try {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        permissionStream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        showError(errorMessage(error, 'Microphone permission was not granted'));
      }
    }
    await Promise.all([populateMics(), checkModelStatus()]);
    setState(await window.api.getRecordingState());
  } catch (error) {
    currentSettings = {
      microphone: 'default', engine: 'local', whisperModel: 'small',
      deepgramApiKey: '', groqApiKey: '', recordingMode: 'toggle',
      hotkey: 'CmdOrCtrl+Shift+Space', accentColor: '#6875f5',
    };
    setState(STATES.READY);
    showError(errorMessage(error, 'Unable to load settings'));
  }
}

void init();
