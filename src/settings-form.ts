import {
  micSelect,
  modelSelect,
  whisperRuntimeSelect,
  binaryPathDisplay,
  selectBinaryBtn,
  recheckBinaryBtn,
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
  geminiRow,
  geminiModelRow,
  downloadBtn,
  downloadProgress,
  progressFill,
  hotkeyDisplay,
} from './dom';
import { getSettings, setSettings } from './store';
import { applyAccentColor } from './theme';
import { showError, showToast } from './status';
import { errorMessage } from './utils';
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
    const saved = await window.api.hasSecret(name);
    targets[name].textContent = saved ? '🔒 Key saved on this device ✓' : 'No key saved';
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
  whisperRuntimeSelect.value = settings.whisperRuntime || 'whisper-cpp';
  binaryPathDisplay.textContent = settings.whisperBinaryPath || 'Not selected';
  deepgramKey.value = settings.deepgramApiKey || '';
  deepgramModelSelect.value = settings.deepgramModel || 'nova-3';
  speechmaticsKey.value = settings.speechmaticsApiKey || '';
  setModeActive(settings.recordingMode);
  setPolishActive(settings.polishMode || 'thorough');
  vocabInput.value = (settings.customVocabulary || []).join('\n');
  hotkeyInput.value = settings.hotkey;
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  accentColor.value = settings.accentColor;
  applyAccentColor(settings.accentColor);
  setTranslationUiFromSettings(settings.translationEnabled);
  await populateLanguages();
  syncTranslationControls();
  refreshAllKeyStatus();
}

export function applySettingsToUi(settings: Settings): void {
  setSettings(settings);
  accentColor.value = settings.accentColor;
  applyAccentColor(settings.accentColor);
  hotkeyInput.value = settings.hotkey;
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  setTranslationUiFromSettings(settings.translationEnabled);
  syncTranslationControls();
}

async function persist() {
  const settings = getSettings();
  if (!settings) return;
  settings.microphone = micSelect.value || 'default';
  settings.whisperModel = modelSelect.value;
  settings.whisperRuntime = whisperRuntimeSelect.value;
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
    showError(errorMessage(error, 'Unable to save settings'));
  }
}

export async function checkModelStatus() {
  const settings = getSettings();
  if (!settings || settings.engine !== 'local') return;
  try {
    const downloaded = await window.api.checkModelDownloaded(modelSelect.value);
    downloadBtn.textContent = downloaded ? '✓' : 'Download';
    downloadBtn.disabled = downloaded;
  } catch (error) {
    downloadBtn.disabled = false;
    showError(errorMessage(error, 'Unable to check model'));
  }
}

export function handleDownloadProgress(progress: DownloadProgress) {
  progressFill.style.width = `${Math.max(0, Math.min(100, progress.percent))}%`;
}

function wireDownload() {
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
}

async function updateBinaryStatus(binaryPath: string) {
  if (!binaryPath) {
    binaryPathDisplay.textContent = 'Not selected';
    return;
  }
  try {
    const ok = await window.api.checkWhisperBinary(binaryPath);
    binaryPathDisplay.textContent = ok ? binaryPath.split(/[/\\]/).pop()! + ' ✓' : binaryPath.split(/[/\\]/).pop()! + ' ✗';
  } catch {
    binaryPathDisplay.textContent = binaryPath.split(/[/\\]/).pop()!;
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
      showError(errorMessage(error, 'Connection failed'));
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
      showError(errorMessage(error, 'Connection failed'));
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
        binaryPathDisplay.textContent = binaryPath.split(/[/\\]/).pop()!;
      }
    } catch (error) {
      showError(errorMessage(error, 'Unable to select binary'));
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

  wireDownload();
}
