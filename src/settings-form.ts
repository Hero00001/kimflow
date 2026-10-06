import {
  micSelect,
  modelSelect,
  binaryPathDisplay,
  selectBinaryBtn,
  recheckBinaryBtn,
  clearBinaryBtn,
  deepgramKey,
  deepgramRemoveKey,
  deepgramKeyStatus,
  deepgramModelSelect,
  deepgramTestBtn,
  speechmaticsKey,
  speechmaticsRemoveKey,
  speechmaticsKeyStatus,
  speechmaticsTestBtn,
  providerSelect,
  inputLanguageSelect,
  translateToSelect,
  geminiKey,
  geminiKeyStatus,
  geminiKeyStatusRow,
  geminiModel,
  hotkeyInput,
  hotkeyRecord,
  accentColor,
  engineGroup,
  localRow,
  speechmaticsRow,
  deepgramRow,
  modeGroup,
  polishGroup,
  vocabInput,
  translationGroup,
  aiPolishGroup,
  geminiRow,
  geminiModelRow,
  downloadBtn,
  downloadProgress,
  downloadLabel,
  progressFill,
  engineCpuBtn,
  engineNvidiaBtn,
  engineAmdBtn,
  engineSuggestion,
  hotkeyDisplay,
  statusError,
} from './dom';
import { getSettings, setSettings } from './store';
import { applyAccentColor } from './theme';
import { STATES, getCurrentState, onStateChange, showError, showToast } from './status';
import { errorDetails, friendlyError } from './utils';
import {
  clearTranslation,
  populateLanguages,
  scheduleModelValidation,
  setTranslationUi,
  syncTranslationControls,
  validateModelField,
} from './translation';

let recordingHotkey = false;
let persistTimer: number | undefined;

function schedulePersist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => { void persist(); }, 500);
}

function formatHotkey(hotkey: string) {
  const isWindows = /win/i.test(navigator.platform || navigator.userAgent);
  return hotkey.replace(/CmdOrCtrl|CommandOrControl/g, isWindows ? 'Ctrl' : 'Cmd');
}

function setModeActive(mode: string) {
  modeGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.mode === mode);
  });
}

function setPolishActive(polishMode: string) {
  polishGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === polishMode);
  });
}

function setAiPolishActive(enabled: boolean) {
  aiPolishGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === (enabled ? 'on' : 'off'));
  });
}

function setEngine(engine: string) {
  const settings = getSettings();
  if (!settings) return;
  settings.engine = engine;
  localRow.classList.toggle('hidden', engine !== 'local');
  speechmaticsRow.classList.toggle('hidden', engine !== 'speechmatics');
  deepgramRow.classList.toggle('hidden', engine !== 'deepgram');
  engineGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === engine);
  });
  if (engine === 'local') {
    void refreshEngineButtons();
    void refreshEngineSuggestion();
  }
}

function setTranslationUiFromSettings(enabled: boolean) {
  setTranslationUi(enabled);
  geminiRow.classList.toggle('hidden', !enabled);
  geminiKeyStatusRow.classList.toggle('hidden', !enabled);
  geminiModelRow.classList.toggle('hidden', !enabled);
}

// Presence only — key values never leave the main process. The password
// fields stay empty by design; this indicator is how users know a key is
// stored.
async function refreshKeyStatus(name: 'deepgramApiKey' | 'speechmaticsApiKey' | 'geminiApiKey'): Promise<void> {
  const targets = {
    deepgramApiKey: deepgramKeyStatus,
    speechmaticsApiKey: speechmaticsKeyStatus,
    geminiApiKey: geminiKeyStatus,
  } as const;
  try {
    const state = await window.api.secretState(name);
    targets[name].textContent = state === 'saved'
      ? '🔒 Key saved on this device ✓'
      : state === 'unreadable'
        ? '⚠ Saved key cannot be read — re-enter it below'
        : 'No key saved';
  } catch {
    targets[name].textContent = 'Key status unavailable';
  }
}

function refreshAllKeyStatus() {
  void refreshKeyStatus('deepgramApiKey');
  void refreshKeyStatus('speechmaticsApiKey');
  void refreshKeyStatus('geminiApiKey');
}

export async function loadSettingsIntoUi(settings: Settings): Promise<void> {
  setSettings(settings);
  setEngine(settings.engine);
  modelSelect.value = settings.whisperModel || 'small';
  showBinaryName(settings.whisperBinaryPath || '');
  deepgramKey.value = settings.deepgramApiKey || '';
  deepgramModelSelect.value = settings.deepgramModel || 'nova-3';
  speechmaticsKey.value = settings.speechmaticsApiKey || '';
  setModeActive(settings.recordingMode);
  setPolishActive(settings.polishMode || 'thorough');
  vocabInput.value = (settings.customVocabulary || []).join('\n');
  setAiPolishActive(settings.aiPolish === true);
  hotkeyInput.value = settings.hotkey;
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  accentColor.value = settings.accentColor;
  applyAccentColor(settings.accentColor);
  setTranslationUiFromSettings(settings.translationEnabled);
  await populateLanguages();
  syncTranslationControls();
  refreshAllKeyStatus();
  applyEngineWindowsGate();
  await refreshEngineButtons();
  await refreshEngineSuggestion();
}

export function applySettingsToUi(settings: Settings): void {
  setSettings(settings);
  accentColor.value = settings.accentColor;
  applyAccentColor(settings.accentColor);
  hotkeyInput.value = settings.hotkey;
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  setTranslationUiFromSettings(settings.translationEnabled);
  syncTranslationControls();
  // Engine labels + binary display must follow every save broadcast,
  // otherwise they freeze on pre-change state.
  void refreshEngineButtons();
  void updateBinaryStatus(settings.whisperBinaryPath || '');
}

let persistChain: Promise<void> = Promise.resolve();

function persist(): void {
  // Serialize saves: debounced keystroke saves and immediate change saves
  // used to finish out of order, letting a stale response overwrite newer
  // input. Chaining makes completion order match initiation order, and each
  // run re-reads the DOM so the last save always carries current values.
  persistChain = persistChain.then(runPersist);
}

async function runPersist(): Promise<void> {
  const settings = getSettings();
  if (!settings) return;
  settings.microphone = micSelect.value || 'default';
  settings.whisperModel = modelSelect.value;
  settings.whisperRuntime = 'whisper-cpp';
  settings.deepgramApiKey = deepgramKey.value;
  settings.deepgramModel = deepgramModelSelect.value;
  settings.speechmaticsApiKey = speechmaticsKey.value;
  settings.translationProvider = providerSelect.value || 'gemini';
  settings.inputLanguage = inputLanguageSelect.value || 'auto';
  settings.translationTarget = translateToSelect.value || 'en';
  settings.geminiApiKey = geminiKey.value;
  settings.geminiModel = geminiModel.value.trim();
  settings.customVocabulary = vocabInput.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 100);
  settings.hotkey = hotkeyInput.value.trim() || settings.hotkey;
  settings.accentColor = accentColor.value;
  applyAccentColor(settings.accentColor);
  try {
    setSettings(await window.api.saveSettings(settings));
    refreshAllKeyStatus();
  } catch (error) {
    const friendly = friendlyError(error, 'Unable to save settings');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

export async function checkModelStatus() {
  const settings = getSettings();
  if (!settings || settings.engine !== 'local') return;
  try {
    const downloaded = await window.api.checkModelDownloaded(modelSelect.value);
    downloadBtn.textContent = downloaded ? '✓ Ready' : 'Download';
    downloadBtn.disabled = downloaded;
  } catch (error) {
    downloadBtn.disabled = false;
    const friendly = friendlyError(error, 'Unable to check model');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

export function handleDownloadProgress(progress: DownloadProgress) {
  const percent = Math.max(0, Math.min(100, progress.percent));
  progressFill.style.width = `${percent}%`;
  downloadLabel.textContent = activeDownloadLabel ? `${activeDownloadLabel}… ${Math.round(percent)}%` : '';
}

let activeDownloadLabel = '';

function showDownloadProgress(label: string) {
  activeDownloadLabel = label;
  downloadLabel.textContent = `${label}… 0%`;
  progressFill.style.width = '0%';
  downloadProgress.classList.remove('hidden');
}

function hideDownloadProgress() {
  activeDownloadLabel = '';
  downloadLabel.textContent = '';
  downloadProgress.classList.add('hidden');
}

function wireDownload() {
  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading…';
    showDownloadProgress(`Downloading ${modelSelect.value} model`);
    try {
      await window.api.downloadModel(modelSelect.value);
      downloadBtn.textContent = '✓ Ready';
    } catch (error) {
      downloadBtn.textContent = 'Retry';
      downloadBtn.disabled = false;
      const friendly = friendlyError(error, 'Download failed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    } finally {
      hideDownloadProgress();
    }
  });
}

async function updateBinaryStatus(binaryPath: string) {
  if (!binaryPath) {
    binaryPathDisplay.textContent = 'Not selected';
    binaryPathDisplay.title = '';
    return;
  }
  try {
    const ok = await window.api.checkWhisperBinary(binaryPath);
    showBinaryName(binaryPath, ok);
  } catch {
    showBinaryName(binaryPath);
  }
}

function showBinaryName(fullPath: string, ok?: boolean) {
  if (!fullPath) {
    binaryPathDisplay.textContent = 'Not selected';
    binaryPathDisplay.title = '';
    return;
  }
  const name = fullPath.split(/[/\\]/).pop() || fullPath;
  binaryPathDisplay.textContent = ok === undefined ? name : `${name} ${ok ? '✓' : '✗'}`;
  binaryPathDisplay.title = fullPath;
}

function isWindowsEngineHost(): boolean {
  return /win/i.test(navigator.platform || navigator.userAgent);
}

function applyEngineWindowsGate(): void {
  const show = isWindowsEngineHost();
  document.getElementById('engine-download-row')?.classList.toggle('hidden', !show);
  document.getElementById('engine-suggestion-row')?.classList.toggle('hidden', !show);
}

function isTranscribingNow(): boolean {
  return getCurrentState() === STATES.TRANSCRIBING;
}

async function refreshEngineButtons(): Promise<void> {
  if (!isWindowsEngineHost()) return;
  let status: Record<string, string> = {};
  try { status = await window.api.engineStatus(); } catch { status = {}; }
  const activePath = getSettings()?.whisperBinaryPath || '';
  const entries: Array<{ button: HTMLButtonElement; flavor: string; label: string }> = [
    { button: engineCpuBtn, flavor: 'cpu', label: 'Download CPU (~8 MB)' },
    { button: engineNvidiaBtn, flavor: 'nvidia', label: 'Download NVIDIA (~273 MB)' },
    { button: engineAmdBtn, flavor: 'amd', label: 'Download AMD (~18 MB)' },
  ];
  for (const { button, flavor, label } of entries) {
    const state = status[flavor] || 'missing';
    // Engine installs nest the binary (e.g. engines/cpu/Release/...) — match
    // the flavor folder + filename, not an exact tail path.
    const parts = activePath.replace(/\\/g, '/').toLowerCase().split('/');
    const root = parts.indexOf('engines');
    const isActive = root !== -1 && parts[root + 1] === flavor && parts[parts.length - 1] === 'whisper-cli.exe';
    button.disabled = state === 'downloading' || isTranscribingNow();
    // Accent highlight + text: color is never the only active signal.
    button.classList.toggle('active', isActive);
    if (state === 'downloading') button.textContent = 'Downloading…';
    else if (isActive) button.textContent = '✓ Active';
    else if (state === 'ready') button.textContent = 'Use ' + label.replace('Download ', '');
    else button.textContent = label;
  }
}

async function downloadEngineFlavor(flavor: string): Promise<void> {
  const clicked = flavor === 'nvidia' ? engineNvidiaBtn : flavor === 'amd' ? engineAmdBtn : engineCpuBtn;
  clicked.disabled = true;
  clicked.textContent = 'Downloading…';
  showDownloadProgress(`Downloading ${flavor} engine`);
  try {
    const exePath = await window.api.downloadEngine(flavor);
    const settings = getSettings();
    if (settings) settings.whisperBinaryPath = exePath;
    showBinaryName(exePath, true);
    showToast('Engine installed ✓');
  } catch (error) {
    // Engine failures already speak human (fingerprint, startup check) —
    // show the first line, keep the whole message in the tooltip.
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/^Engine /.test(message)) {
      showError(message.split('\n')[0]);
      statusError.title = message;
    } else {
      const friendly = friendlyError(error, 'Engine download failed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    }
  } finally {
    hideDownloadProgress();
    await refreshEngineButtons();
    await updateBinaryStatus(getSettings()?.whisperBinaryPath || '');
  }
}

async function refreshEngineSuggestion(): Promise<void> {
  if (!isWindowsEngineHost()) return;
  try {
    const gpu = await window.api.detectGpu();
    const names: Record<string, string> = { nvidia: 'NVIDIA', amd: 'AMD', cpu: 'CPU' };
    engineSuggestion.textContent = `Suggested for your PC: ${names[gpu] || 'CPU'}`;
    engineSuggestion.classList.remove('hidden');
  } catch {
    engineSuggestion.classList.add('hidden');
  }
}

export function wireSettingsControls() {
  engineGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    setEngine(button.dataset.value);
    void persist();
    void checkModelStatus();
  });

  modeGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.mode) return;
    const settings = getSettings();
    if (!settings) return;
    settings.recordingMode = button.dataset.mode;
    setModeActive(settings.recordingMode);
    void persist();
  });

  polishGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    const settings = getSettings();
    if (!settings) return;
    settings.polishMode = button.dataset.value;
    setPolishActive(settings.polishMode);
    void persist();
  });

  translationGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    const settings = getSettings();
    if (!settings) return;
    const enabled = button.dataset.value === 'on';
    settings.translationEnabled = enabled;
    translationGroup.querySelectorAll('.toggle-btn').forEach((item) => {
      item.classList.toggle('active', (item as HTMLElement).dataset.value === (enabled ? 'on' : 'off'));
    });
    setTranslationUiFromSettings(enabled);
    if (!enabled) clearTranslation();
    void persist();
  });

  aiPolishGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    const settings = getSettings();
    if (!settings) return;
    settings.aiPolish = button.dataset.value === 'on';
    setAiPolishActive(settings.aiPolish);
    void persist();
  });

  providerSelect.addEventListener('change', () => { void persist(); });
  inputLanguageSelect.addEventListener('change', () => { void persist(); });
  translateToSelect.addEventListener('change', () => { void persist(); });
  geminiKey.addEventListener('change', () => { void persist(); });
  geminiModel.addEventListener('change', () => { void persist(); });
  geminiModel.addEventListener('input', scheduleModelValidation);
  geminiModel.addEventListener('blur', () => { void validateModelField(); });

  micSelect.addEventListener('change', () => { void persist(); });
  vocabInput.addEventListener('change', () => { void persist(); });
  vocabInput.addEventListener('input', schedulePersist);
  modelSelect.addEventListener('change', () => { void checkModelStatus(); void persist(); });
  deepgramKey.addEventListener('change', () => { void persist(); });
  deepgramKey.addEventListener('input', schedulePersist);
  deepgramModelSelect.addEventListener('change', () => { void persist(); });
  speechmaticsKey.addEventListener('change', () => { void persist(); });
  speechmaticsKey.addEventListener('input', schedulePersist);
  geminiKey.addEventListener('input', schedulePersist);

  // Deepgram test connection
  deepgramTestBtn.addEventListener('click', async () => {
    const key = deepgramKey.value.trim();
    if (!key) { showError('Enter a Deepgram API key first.'); return; }
    deepgramTestBtn.disabled = true;
    deepgramTestBtn.textContent = 'Testing…';
    try {
      const result = await window.api.testDeepgramConnection(key);
      showToast(result.message);
      void persist();
      void refreshKeyStatus('deepgramApiKey');
      deepgramTestBtn.textContent = '✓ Connected';
      setTimeout(() => { deepgramTestBtn.textContent = 'Test Connection'; }, 2500);
    } catch (error) {
      const friendly = friendlyError(error, 'Connection failed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
      deepgramTestBtn.textContent = 'Test Connection';
    } finally {
      deepgramTestBtn.disabled = false;
    }
  });

  // Speechmatics test connection
  speechmaticsTestBtn.addEventListener('click', async () => {
    const key = speechmaticsKey.value.trim();
    if (!key) { showError('Enter a Speechmatics API key first.'); return; }
    speechmaticsTestBtn.disabled = true;
    speechmaticsTestBtn.textContent = 'Testing…';
    try {
      const result = await window.api.testSpeechmaticsConnection(key);
      showToast(result.message);
      void persist();
      void refreshKeyStatus('speechmaticsApiKey');
      speechmaticsTestBtn.textContent = '✓ Connected';
      setTimeout(() => { speechmaticsTestBtn.textContent = 'Test Connection'; }, 2500);
    } catch (error) {
      const friendly = friendlyError(error, 'Connection failed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
      speechmaticsTestBtn.textContent = 'Test Connection';
    } finally {
      speechmaticsTestBtn.disabled = false;
    }
  });

  // Remove API keys
  deepgramRemoveKey.addEventListener('click', () => {
    deepgramKey.value = '';
    void window.api.deleteSecret('deepgramApiKey').catch(() => undefined);
    void persist();
    void refreshKeyStatus('deepgramApiKey');
    showToast('Deepgram key removed');
  });

  speechmaticsRemoveKey.addEventListener('click', () => {
    speechmaticsKey.value = '';
    void window.api.deleteSecret('speechmaticsApiKey').catch(() => undefined);
    void persist();
    void refreshKeyStatus('speechmaticsApiKey');
    showToast('Speechmatics key removed');
  });

  selectBinaryBtn.addEventListener('click', async () => {
    try {
      const binaryPath = await window.api.selectWhisperBinary();
      if (binaryPath) {
        const settings = getSettings();
        if (settings) {
          settings.whisperBinaryPath = binaryPath;
          void persist();
        }
        showBinaryName(binaryPath);
      }
    } catch (error) {
      const friendly = friendlyError(error, 'Unable to select binary');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    }
  });

  recheckBinaryBtn.addEventListener('click', async () => {
    const settings = getSettings();
    if (settings?.whisperBinaryPath) {
      await updateBinaryStatus(settings.whisperBinaryPath);
    } else {
      showError('No binary selected. Use Select Binary first.');
    }
  });

  clearBinaryBtn.addEventListener('click', () => {
    // Clearing hands control back: pick any engine button (or Browse again)
    // to choose what transcribes next. The file itself is left on disk.
    const settings = getSettings();
    if (settings) {
      settings.whisperBinaryPath = '';
      void persist();
    }
    showBinaryName('');
    showToast('Custom binary cleared');
    void refreshEngineButtons();
  });

  applyEngineWindowsGate();
  engineCpuBtn.addEventListener('click', () => { void downloadEngineFlavor('cpu'); });
  engineNvidiaBtn.addEventListener('click', () => { void downloadEngineFlavor('nvidia'); });
  engineAmdBtn.addEventListener('click', () => { void downloadEngineFlavor('amd'); });
  onStateChange(() => { void refreshEngineButtons(); });

  accentColor.addEventListener('input', () => { void persist(); });
  hotkeyInput.addEventListener('change', () => { void persist(); });
  function stopHotkeyRecord() {
    recordingHotkey = false;
    hotkeyRecord.textContent = 'Record';
    hotkeyInput.classList.remove('recording');
  }
  hotkeyRecord.addEventListener('click', () => {
    recordingHotkey = !recordingHotkey;
    hotkeyRecord.textContent = recordingHotkey ? 'Press keys…' : 'Record';
    hotkeyInput.classList.toggle('recording', recordingHotkey);
    if (recordingHotkey) hotkeyInput.focus();
  });
  hotkeyInput.addEventListener('keydown', (event) => {
    if (!recordingHotkey) return;
    event.preventDefault();
    // Escape or focus loss cancels capture instead of sticking on "Press keys…".
    if (event.key === 'Escape') { stopHotkeyRecord(); return; }
    const modifiers = [
      event.ctrlKey ? 'Ctrl' : '', event.metaKey ? 'Command' : '',
      event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) {
      hotkeyInput.value = [...modifiers, key].join('+');
      stopHotkeyRecord();
      void persist();
    }
  });
  hotkeyInput.addEventListener('blur', () => {
    if (recordingHotkey) stopHotkeyRecord();
  });

  wireDownload();
}
