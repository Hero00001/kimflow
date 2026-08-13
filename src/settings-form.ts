import {
  micSelect,
  modelSelect,
  groqKey,
  deepgramKey,
  providerSelect,
  inputLanguageSelect,
  translateToSelect,
  geminiKey,
  geminiModel,
  hotkeyInput,
  hotkeyRecord,
  accentColor,
  engineGroup,
  localRow,
  groqRow,
  deepgramRow,
  modeGroup,
  translationGroup,
  downloadBtn,
  downloadProgress,
  progressFill,
  hotkeyDisplay,
} from './dom';
import { getSettings, setSettings } from './store';
import { applyAccentColor } from './theme';
import { showError } from './status';
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

function formatHotkey(hotkey: string) {
  const isWindows = /win/i.test(navigator.platform || navigator.userAgent);
  return hotkey.replace(/CmdOrCtrl|CommandOrControl/g, isWindows ? 'Ctrl' : 'Cmd');
}

function setModeActive(mode: string) {
  modeGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.mode === mode);
  });
}

function setEngine(engine: string) {
  const settings = getSettings();
  if (!settings) return;
  settings.engine = engine;
  localRow.classList.toggle('hidden', engine !== 'local');
  groqRow.classList.toggle('hidden', engine !== 'groq');
  deepgramRow.classList.toggle('hidden', engine !== 'deepgram');
  engineGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === engine);
  });
}

export async function loadSettingsIntoUi(settings: Settings): Promise<void> {
  setSettings(settings);
  setEngine(settings.engine);
  modelSelect.value = settings.whisperModel;
  groqKey.value = settings.groqApiKey || '';
  deepgramKey.value = settings.deepgramApiKey || '';
  setModeActive(settings.recordingMode);
  hotkeyInput.value = settings.hotkey;
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  accentColor.value = settings.accentColor;
  applyAccentColor(settings.accentColor);
  await populateLanguages();
  syncTranslationControls();
}

export function applySettingsToUi(settings: Settings): void {
  setSettings(settings);
  accentColor.value = settings.accentColor;
  applyAccentColor(settings.accentColor);
  hotkeyInput.value = settings.hotkey;
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  syncTranslationControls();
}

async function persist() {
  const settings = getSettings();
  if (!settings) return;
  settings.microphone = micSelect.value || 'default';
  settings.whisperModel = modelSelect.value;
  settings.groqApiKey = groqKey.value;
  settings.deepgramApiKey = deepgramKey.value;
  settings.translationProvider = providerSelect.value || 'gemini';
  settings.inputLanguage = inputLanguageSelect.value || 'auto';
  settings.translationTarget = translateToSelect.value || 'en';
  settings.geminiApiKey = geminiKey.value;
  settings.geminiModel = geminiModel.value.trim();
  settings.hotkey = hotkeyInput.value.trim() || settings.hotkey;
  settings.accentColor = accentColor.value;
  applyAccentColor(settings.accentColor);
  try {
    setSettings(await window.api.saveSettings(settings));
  } catch (error) {
    showError(errorMessage(error, 'Unable to save settings'));
  }
}

export async function checkModelStatus() {
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

export function wireSettingsControls() {
  engineGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    setEngine(button.dataset.value);
    void persist();
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

  micSelect.addEventListener('change', () => { void persist(); });
  modelSelect.addEventListener('change', () => { void checkModelStatus(); void persist(); });
  groqKey.addEventListener('change', () => { void persist(); });
  deepgramKey.addEventListener('change', () => { void persist(); });

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
