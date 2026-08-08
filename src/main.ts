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
let recordingHotkey = false;
let historyData: HistoryData = { sessions: [] };
let historyQuery = '';

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const statusError = document.getElementById('status-error')!;
const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const recordIconMic = document.getElementById('record-icon-mic')!;
const recordIconStop = document.getElementById('record-icon-stop')!;
const hotkeyDisplay = document.getElementById('hotkey-display')!;
const transcriptText = document.getElementById('transcript-text')!;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const endBtn = document.getElementById('end-btn') as HTMLButtonElement;
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
const hotkeyInput = document.getElementById('hotkey-input') as HTMLInputElement;
const hotkeyRecord = document.getElementById('hotkey-record') as HTMLButtonElement;
const accentColor = document.getElementById('accent-color') as HTMLInputElement;
const historySearch = document.getElementById('history-search') as HTMLInputElement;
const historyList = document.getElementById('history-list')!;
const historyEmpty = document.getElementById('history-empty')!;
const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement;
const translationGroup = document.getElementById('translation-group')!;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const inputLanguageSelect = document.getElementById('input-language-select') as HTMLSelectElement;
const translateToSelect = document.getElementById('translate-to-select') as HTMLSelectElement;
const geminiKey = document.getElementById('gemini-key') as HTMLInputElement;
const geminiModel = document.getElementById('gemini-model') as HTMLInputElement;
const geminiModelStatus = document.getElementById('gemini-model-status')!;
const translationArea = document.getElementById('translation-area')!;
const translationText = document.getElementById('translation-text')!;
const translationError = document.getElementById('translation-error')!;
const copyTranslationBtn = document.getElementById('copy-translation-btn') as HTMLButtonElement;
const providerRow = document.getElementById('provider-row')!;
const translateToRow = document.getElementById('translate-to-row')!;

const STATES = {
  READY: 'ready',
  RECORDING: 'recording',
  PAUSED: 'paused',
  TRANSCRIBING: 'transcribing',
} as const;

const PAGES = {
  transcribe: document.getElementById('page-transcribe')!,
  history: document.getElementById('page-history')!,
  settings: document.getElementById('page-settings')!,
};
const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'));

function goToPage(page: string) {
  (Object.keys(PAGES) as Array<keyof typeof PAGES>).forEach((name) => {
    PAGES[name].classList.toggle('hidden', name !== page);
  });
  navButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.page === page);
  });
  if (page === 'history') refreshHistory();
}

navButtons.forEach((button) => {
  button.addEventListener('click', () => goToPage(button.dataset.page || 'transcribe'));
});

function setState(state: string) {
  currentState = state;
  recordBtn.classList.remove('recording', 'transcribing');
  recordIconMic.style.display = 'flex';
  recordIconStop.style.display = 'none';
  statusDot.className = '';
  statusError.classList.add('hidden');

  const interactive = state !== STATES.TRANSCRIBING;
  const active = state === STATES.RECORDING || state === STATES.PAUSED;

  if (state === STATES.RECORDING) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('recording');
    statusText.textContent = 'Recording';
    pauseBtn.textContent = 'Pause';
  } else if (state === STATES.PAUSED) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('recording');
    statusText.textContent = 'Paused';
    pauseBtn.textContent = 'Resume';
  } else if (state === STATES.TRANSCRIBING) {
    recordBtn.classList.add('transcribing');
    statusDot.classList.add('transcribing');
    statusText.textContent = 'Transcribing…';
  } else {
    statusDot.classList.add('ready');
    statusText.textContent = 'Ready';
  }

  recordBtn.disabled = !interactive;
  recordBtn.setAttribute('aria-label', state === STATES.RECORDING ? 'Stop Recording' : 'Start Recording');
  micBtn.disabled = !interactive;
  pauseBtn.disabled = !active;
  stopBtn.disabled = !active;
  endBtn.disabled = !interactive;
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
    if (result) {
      showTranscript(result.text);
      showTranslation(result.translation, result.translationError);
    }
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
    else if (currentState === STATES.PAUSED) await resumeFromOverlay();
  }
}

function wireToggle(button: HTMLButtonElement) {
  button.addEventListener('click', () => {
    if (currentSettings?.recordingMode === 'toggle') void handleTrigger(true);
  });
  button.addEventListener('pointerdown', (event) => {
    if (currentSettings?.recordingMode === 'push-to-talk') {
      event.preventDefault();
      void handleTrigger(true);
    }
  });
  button.addEventListener('pointerup', (event) => {
    if (currentSettings?.recordingMode === 'push-to-talk') {
      event.preventDefault();
      void handleTrigger(false);
    }
  });
  button.addEventListener('pointerleave', () => {
    if (currentSettings?.recordingMode === 'push-to-talk') void handleTrigger(false);
  });
}

wireToggle(recordBtn);
wireToggle(micBtn);

pauseBtn.addEventListener('click', () => {
  if (currentState === STATES.RECORDING) void pauseFromOverlay();
  else if (currentState === STATES.PAUSED) void resumeFromOverlay();
});

stopBtn.addEventListener('click', () => void finishRecording());

endBtn.addEventListener('click', () => {
  if (currentState !== STATES.READY) {
    void cancelFromOverlay();
  }
  transcriptText.textContent = '';
  clearTranslation();
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
  if (currentState === STATES.RECORDING || currentState === STATES.PAUSED) {
    void finishRecording();
  }
});

function showTranscript(text: string) {
  transcriptText.textContent = text || '';
}

function showTranslation(translation: string | null, error: string | null = null) {
  translationText.textContent = translation || '';
  if (error) {
    translationError.textContent = `Translation failed: ${error}`;
    translationError.classList.remove('hidden');
  } else {
    translationError.classList.add('hidden');
  }
  translationArea.classList.toggle('hidden', !(currentSettings && currentSettings.translationEnabled && (translation || error)));
}

function clearTranslation() {
  translationText.textContent = '';
  translationError.textContent = '';
  translationError.classList.add('hidden');
  translationArea.classList.add('hidden');
}

function setTranslationUi(enabled: boolean) {
  providerRow.classList.toggle('hidden', !enabled);
  translateToRow.classList.toggle('hidden', !enabled);
}

function syncTranslationControls() {
  if (!currentSettings) return;
  providerSelect.value = currentSettings.translationProvider || 'gemini';
  inputLanguageSelect.value = currentSettings.inputLanguage || 'auto';
  translateToSelect.value = currentSettings.translationTarget || 'en';
  geminiKey.value = currentSettings.geminiApiKey || '';
  geminiModel.value = currentSettings.geminiModel || '';
  translationGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === (currentSettings.translationEnabled ? 'on' : 'off'));
  });
  setTranslationUi(currentSettings.translationEnabled);
  if (!currentSettings.geminiModel) {
    setModelStatus('neutral', 'Leave empty for automatic model selection.');
  } else {
    void validateModelField();
  }
}

function setModelStatus(status: 'neutral' | 'ok' | 'err', text: string) {
  geminiModelStatus.className = `model-status ${status}`;
  geminiModelStatus.textContent = text;
}

async function validateModelField() {
  const value = geminiModel.value.trim();
  if (!value) {
    setModelStatus('neutral', 'Leave empty for automatic model selection.');
    return;
  }
  setModelStatus('neutral', 'Checking…');
  try {
    const status = await window.api.validateGeminiModel(value);
    setModelStatus(status.ok ? 'ok' : 'err', status.message);
  } catch {
    setModelStatus('neutral', 'Could not validate model right now. It will be checked before translating.');
  }
}

let modelValidateTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleModelValidation() {
  if (modelValidateTimer) clearTimeout(modelValidateTimer);
  modelValidateTimer = setTimeout(() => { void validateModelField(); }, 400);
}

async function populateLanguages() {
  try {
    const data = await window.api.getLanguages();
    inputLanguageSelect.replaceChildren();
    for (const option of data.input) {
      inputLanguageSelect.appendChild(new Option(option.label, option.value));
    }
    translateToSelect.replaceChildren();
    for (const option of data.target) {
      translateToSelect.appendChild(new Option(option.label, option.value));
    }
  } catch {
    inputLanguageSelect.replaceChildren(new Option('Auto Detect', 'auto'));
    translateToSelect.replaceChildren(new Option('English', 'en'));
  }
}

copyBtn.addEventListener('click', async () => {
  const text = transcriptText.textContent || '';
  if (!text) return;
  try {
    await window.api.copyText(text);
    showToast('Copied!');
  } catch {
    showError('Unable to copy transcript');
  }
});

copyTranslationBtn.addEventListener('click', async () => {
  const text = translationText.textContent || '';
  if (!text) return;
  try {
    await window.api.copyText(text);
    showToast('Copied!');
  } catch {
    showError('Unable to copy translation');
  }
});

translationGroup.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
  if (!button?.dataset.value || !currentSettings) return;
  const enabled = button.dataset.value === 'on';
  currentSettings.translationEnabled = enabled;
  translationGroup.querySelectorAll('.toggle-btn').forEach((item) => {
    item.classList.toggle('active', (item as HTMLElement).dataset.value === (enabled ? 'on' : 'off'));
  });
  setTranslationUi(enabled);
  if (!enabled) clearTranslation();
  void persist();
});

providerSelect.addEventListener('change', () => { void persist(); });
inputLanguageSelect.addEventListener('change', () => { void persist(); });
translateToSelect.addEventListener('change', () => { void persist(); });
geminiKey.addEventListener('change', () => { void persist(); });
geminiModel.addEventListener('change', () => { void persist(); });
geminiModel.addEventListener('input', scheduleModelValidation);
geminiModel.addEventListener('blur', () => { void validateModelField(); });

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
  document.documentElement.style.setProperty('--accent-subtle', hexToRgba(color, 0.14));
}

async function persist() {
  if (!currentSettings) return;
  currentSettings.microphone = micSelect.value || 'default';
  currentSettings.whisperModel = modelSelect.value;
  currentSettings.groqApiKey = groqKey.value;
  currentSettings.deepgramApiKey = deepgramKey.value;
  currentSettings.translationProvider = providerSelect.value || 'gemini';
  currentSettings.inputLanguage = inputLanguageSelect.value || 'auto';
  currentSettings.translationTarget = translateToSelect.value || 'en';
  currentSettings.geminiApiKey = geminiKey.value;
  currentSettings.geminiModel = geminiModel.value.trim();
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

// ── Window controls ─────────────────────────────────────

if (/mac/i.test(navigator.platform || navigator.userAgent)) {
  document.body.classList.add('platform-mac');
}

document.getElementById('win-min')!.addEventListener('click', () => void window.api.windowControl('minimize'));
document.getElementById('win-max')!.addEventListener('click', () => void window.api.windowControl('toggle-maximize'));
document.getElementById('win-close')!.addEventListener('click', () => void window.api.windowControl('close'));

// ── History ─────────────────────────────────────────────

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return seconds ? `${minutes} min ${seconds} sec` : `${minutes} min`;
}

function formatRelativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const day = 24 * 60 * 60 * 1000;
  if (diff < day) return 'Today';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return `${Math.floor(diff / day)} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

function renderHistory() {
  const query = historyQuery.trim().toLowerCase();
  const filtered = query
    ? historyData.sessions.filter((session) => {
        return session.title.toLowerCase().includes(query) || session.text.toLowerCase().includes(query);
      })
    : historyData.sessions;
  historyList.replaceChildren();
  historyEmpty.classList.toggle('hidden', filtered.length > 0);
  for (const entry of filtered) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'history-item';
    const title = document.createElement('span');
    title.className = 'history-item-title';
    title.textContent = entry.title;
    const meta = document.createElement('span');
    meta.className = 'history-item-meta';
    meta.textContent = `${formatRelativeTime(entry.createdAt)} • ${formatDuration(entry.durationMs)}`;
    item.append(title, meta);
    item.addEventListener('click', () => {
      showTranscript(entry.text);
      goToPage('transcribe');
    });
    historyList.appendChild(item);
  }
}

function refreshHistory() {
  void window.api.getHistory().then((data) => {
    historyData = data;
    renderHistory();
  }).catch(() => undefined);
}

historySearch.addEventListener('input', () => {
  historyQuery = historySearch.value;
  renderHistory();
});

clearHistoryBtn.addEventListener('click', () => {
  void window.api.clearHistory().then((data) => {
    historyData = data;
    renderHistory();
  }).catch(() => undefined);
});

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
      hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
      syncTranslationControls();
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
    window.api.onTranscriptionResult((result) => {
      if (result) {
        showTranscript(result.text);
        showTranslation(result.translation, result.translationError);
      }
    }),
    window.api.onDownloadProgress((progress: DownloadProgress) => {
      progressFill.style.width = `${Math.max(0, Math.min(100, progress.percent))}%`;
    }),
    window.api.onHistoryUpdated((data) => {
      historyData = data;
      renderHistory();
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
    hotkeyInput.value = currentSettings.hotkey;
    hotkeyDisplay.textContent = formatHotkey(currentSettings.hotkey);
    accentColor.value = currentSettings.accentColor;
    applyAccentColor(currentSettings.accentColor);
    await populateLanguages();
    syncTranslationControls();
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
    refreshHistory();
  } catch (error) {
    currentSettings = {
      microphone: 'default', engine: 'local', whisperModel: 'small',
      deepgramApiKey: '', groqApiKey: '', recordingMode: 'toggle',
      hotkey: 'CmdOrCtrl+Shift+Space', accentColor: '#8b5cf6',
      translationEnabled: false, translationProvider: 'gemini',
      geminiApiKey: '', geminiModel: '', inputLanguage: 'auto', translationTarget: 'en',
    };
    setState(STATES.READY);
    showError(errorMessage(error, 'Unable to load settings'));
  }
}

void init();
