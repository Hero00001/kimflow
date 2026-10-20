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
  uiLanguageSelect,
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
import { STATES, getCurrentState, onStateChange, refreshStatusText, showError, showToast } from './status';
import { errorDetails, errorText, friendlyError } from './utils';
import { applyLanguage, cssContentValue, normalizeUILanguage, renderStatic, t } from './i18n';
import { renderHistory } from './history';
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

/**
 * The custom Whisper binary currently selected.
 *
 * This is one of six settings with no form control of their own, so their
 * value cannot be re-read from the DOM like every other field. The settings
 * form owns them: the toggle groups are read from their active button, and
 * the binary path is kept here.
 *
 * They are owned deliberately. The shared settings object is replaced
 * wholesale by every save response and every 'settings-updated' broadcast,
 * and those snapshots are serialised at send time — so a snapshot can
 * predate the user's latest change and silently undo it. Reading these six
 * from the UI instead of from the shared object makes that impossible.
 */
let currentBinaryPath = '';

/** The `data-value`/`data-mode` of a toggle group's active button. */
function activeToggleValue(group: HTMLElement, attribute: 'value' | 'mode'): string {
  const active = group.querySelector('.toggle-btn.active') as HTMLElement | null;
  return active?.dataset[attribute] || '';
}

/** The six settings the settings form owns, read from the UI. */
function ownedSettings(): Pick<
  Settings,
  'engine' | 'recordingMode' | 'polishMode' | 'translationEnabled' | 'aiPolish' | 'whisperBinaryPath'
> {
  return {
    engine: activeToggleValue(engineGroup, 'value') || 'local',
    recordingMode: activeToggleValue(modeGroup, 'mode') || 'toggle',
    polishMode: activeToggleValue(polishGroup, 'value') || 'thorough',
    translationEnabled: activeToggleValue(translationGroup, 'value') === 'on',
    aiPolish: activeToggleValue(aiPolishGroup, 'value') === 'on',
    whisperBinaryPath: currentBinaryPath,
  };
}

/**
 * Write settings to the shared store without letting a server snapshot undo
 * the values the settings form owns.
 */
function setOwnedSettings(settings: Settings): void {
  setSettings({ ...settings, ...ownedSettings() });
}

function schedulePersist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => { void persist(); }, 500);
}

// Modifier key names match the physical keycaps, so they are never translated.
function formatHotkey(hotkey: string) {
  const isWindows = /win/i.test(navigator.platform || navigator.userAgent);
  return hotkey.replace(/CmdOrCtrl|CommandOrControl/g, isWindows ? 'Ctrl' : 'Cmd');
}

/** Drive the `:empty::after` placeholders, which cannot carry data-i18n. */
function applyEmptyStateText() {
  const root = document.documentElement;
  root.style.setProperty('--i18n-empty-transcript', cssContentValue(t('transcribe.empty')));
  root.style.setProperty('--i18n-empty-translation', cssContentValue(t('translation.empty')));
}

/**
 * Apply the UI language and re-render every piece of dynamic text that is not
 * covered by a `data-i18n` attribute (status row, history list, ...).
 */
function applyLanguageToUi(language: string): void {
  applyLanguage(language);
  renderStatic();
  applyEmptyStateText();
  refreshStatusText();
  renderHistory();
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

/**
 * The translation toggle's active class is owned by this form. The
 * translation module reads the enabled state from the DOM rather than
 * re-deriving it from a settings snapshot, which may be stale.
 */
function setTranslationActive(enabled: boolean) {
  translationGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === (enabled ? 'on' : 'off'));
  });
}

function setEngine(engine: string) {
  if (!getSettings()) return;
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
      ? t('settings.key.saved')
      : state === 'unreadable'
        ? t('settings.key.unreadable')
        : t('settings.key.none');
  } catch {
    targets[name].textContent = t('settings.key.unavailable');
  }
}

function refreshAllKeyStatus() {
  void refreshKeyStatus('deepgramApiKey');
  void refreshKeyStatus('speechmaticsApiKey');
  void refreshKeyStatus('geminiApiKey');
}

export async function loadSettingsIntoUi(settings: Settings): Promise<void> {
  setSettings(settings);
  currentBinaryPath = settings.whisperBinaryPath || '';
  uiLanguageSelect.value = normalizeUILanguage(settings.uiLanguage);
  applyLanguageToUi(settings.uiLanguage);
  setEngine(settings.engine);
  modelSelect.value = settings.whisperModel || 'small';
  showBinaryName(settings.whisperBinaryPath || '');
  // The key inputs are write-only: the backend blanks key fields before
  // returning them, so populating these from a settings payload could only
  // ever erase what the user typed. The key-status indicator below is what
  // tells the user a key is stored.
  deepgramModelSelect.value = settings.deepgramModel || 'nova-3';
  setModeActive(settings.recordingMode);
  setPolishActive(settings.polishMode || 'thorough');
  vocabInput.value = (settings.customVocabulary || []).join('\n');
  setAiPolishActive(settings.aiPolish === true);
  // The translation toggle's active class is owned by this form (the
  // translation module must not re-derive it from a possibly stale snapshot),
  // so it is set here on first load.
  setTranslationActive(settings.translationEnabled === true);
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

/**
 * React to a settings snapshot broadcast from the main process.
 *
 * A snapshot is serialised at send time, so it can predate whatever the user
 * has done since. Only fields that cannot lose information are applied here;
 * the editable controls keep whatever the user has entered, and the six
 * settings the form owns keep their UI state.
 */
export function applySettingsToUi(settings: Settings): void {
  setOwnedSettings(settings);
  // Key status is a fact about the OS keychain, not a user edit, so it is
  // safe — and necessary — to refresh it from every snapshot.
  refreshAllKeyStatus();
  // Engine labels + binary display must follow every save broadcast,
  // otherwise they freeze on pre-change state.
  void refreshEngineButtons();
  void updateBinaryStatus(currentBinaryPath);
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
  // The UI language is independent of inputLanguage / translationTarget:
  // it only changes how the interface renders.
  settings.uiLanguage = uiLanguageSelect.value || settings.uiLanguage;
  // The six settings with no form control are read from the UI, not from the
  // shared settings object: the object is replaced by every save response and
  // broadcast, and those snapshots can predate the user's latest change.
  Object.assign(settings, ownedSettings());
  applyAccentColor(settings.accentColor);
  try {
    const requestedHotkey = settings.hotkey;
    const saved = await window.api.saveSettings(settings);
    setOwnedSettings(saved);
    refreshAllKeyStatus();
    // The hotkey is the one setting that can fail to apply: another
    // application may already own the shortcut. The main process falls back
    // to the hotkey that is working, so the saved hotkey differs from the
    // requested one — tell the user, rather than silently ignoring it.
    if (saved.hotkey !== requestedHotkey) {
      hotkeyInput.value = saved.hotkey;
      hotkeyDisplay.textContent = formatHotkey(saved.hotkey);
      showError(t('error.hotkeyInUse'));
    }
  } catch (error) {
    const friendly = friendlyError(error, 'error.saveSettings');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

export async function checkModelStatus() {
  const settings = getSettings();
  if (!settings || settings.engine !== 'local') return;
  try {
    const downloaded = await window.api.checkModelDownloaded(modelSelect.value);
    downloadBtn.textContent = downloaded ? t('settings.download.ready') : t('settings.download.download');
    downloadBtn.disabled = downloaded;
  } catch (error) {
    downloadBtn.disabled = false;
    const friendly = friendlyError(error, 'error.checkModel');
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
    downloadBtn.textContent = t('settings.download.downloading');
    showDownloadProgress(t('settings.model.downloading', { model: modelSelect.value }));
    try {
      await window.api.downloadModel(modelSelect.value);
      downloadBtn.textContent = t('settings.download.ready');
    } catch (error) {
      downloadBtn.textContent = t('settings.download.retry');
      downloadBtn.disabled = false;
      const friendly = friendlyError(error, 'error.downloadFailed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    } finally {
      hideDownloadProgress();
    }
  });
}

async function updateBinaryStatus(binaryPath: string) {
  if (!binaryPath) {
    binaryPathDisplay.textContent = t('settings.binary.notSelected');
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
    binaryPathDisplay.textContent = t('settings.binary.notSelected');
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

// Flavor display names and sizes are stable product data; only the surrounding
// sentence is localised (via settings.engine.download.flavor / useFlavor).
const ENGINE_FLAVORS: Array<{ button: HTMLButtonElement; flavor: string; display: string; size: string }> = [
  { button: engineCpuBtn, flavor: 'cpu', display: 'CPU', size: '8 MB' },
  { button: engineNvidiaBtn, flavor: 'nvidia', display: 'NVIDIA', size: '273 MB' },
  { button: engineAmdBtn, flavor: 'amd', display: 'AMD', size: '18 MB' },
];

async function refreshEngineButtons(): Promise<void> {
  if (!isWindowsEngineHost()) return;
  let status: Record<string, string> = {};
  try { status = await window.api.engineStatus(); } catch { status = {}; }
  const activePath = currentBinaryPath;
  for (const { button, flavor, display, size } of ENGINE_FLAVORS) {
    const state = status[flavor] || 'missing';
    // Engine installs nest the binary (e.g. engines/cpu/Release/...) — match
    // the flavor folder + filename, not an exact tail path.
    const parts = activePath.replace(/\\/g, '/').toLowerCase().split('/');
    const root = parts.indexOf('engines');
    const isActive = root !== -1 && parts[root + 1] === flavor && parts[parts.length - 1] === 'whisper-cli.exe';
    button.disabled = state === 'downloading' || isTranscribingNow();
    // Accent highlight + text: color is never the only active signal.
    button.classList.toggle('active', isActive);
    button.title = '';
    if (state === 'downloading') button.textContent = t('settings.download.downloading');
    else if (isActive) button.textContent = t('settings.engine.active');
    else if (state === 'incompatible') {
      button.textContent = t('settings.engine.incompatible');
      button.title = t('settings.engine.incompatibleTooltip');
    } else if (state === 'ready') button.textContent = t('settings.engine.useFlavor', { flavor: display, size });
    else button.textContent = t('settings.engine.download.flavor', { flavor: display, size });
  }
}

async function downloadEngineFlavor(flavor: string): Promise<void> {
  const clicked = flavor === 'nvidia' ? engineNvidiaBtn : flavor === 'amd' ? engineAmdBtn : engineCpuBtn;
  // An installed-but-incompatible build switches directly: re-proving a
  // known failure would just replay the same error on every click.
  let preState = '';
  try { preState = (await window.api.engineStatus())[flavor] || ''; } catch { preState = ''; }
  if (preState === 'incompatible') {
    try {
      const exePath = await window.api.activateEngine(flavor);
      currentBinaryPath = exePath;
      showBinaryName(exePath, true);
      showToast(t('settings.engine.switchedIncompatible'));
    } catch (error) {
      // Translate the summary; keep the full backend message in the tooltip.
      showError(friendlyError(error, 'error.engineStartupFailed'));
      statusError.title = errorText(error);
    } finally {
      await refreshEngineButtons();
      await updateBinaryStatus(currentBinaryPath);
    }
    return;
  }
  clicked.disabled = true;
  clicked.textContent = t('settings.download.downloading');
  showDownloadProgress(t('settings.engine.downloading', { flavor }));
  try {
    const exePath = await window.api.downloadEngine(flavor);
    currentBinaryPath = exePath;
    showBinaryName(exePath, true);
    showToast(t('settings.engine.installed'));
  } catch (error) {
    // Engine failures already speak human (fingerprint, startup check) —
    // show the translated summary, keep the whole message in the tooltip.
    const message = errorText(error);
    if (/^Engine /.test(message)) {
      showError(t('error.engineStartupFailed'));
      statusError.title = message;
    } else {
      const friendly = friendlyError(error, 'error.engineDownloadFailed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    }
  } finally {
    hideDownloadProgress();
    await refreshEngineButtons();
    await updateBinaryStatus(currentBinaryPath);
  }
}

async function refreshEngineSuggestion(): Promise<void> {
  if (!isWindowsEngineHost()) return;
  try {
    const gpu = await window.api.detectGpu();
    const names: Record<string, string> = { nvidia: 'NVIDIA', amd: 'AMD', cpu: 'CPU' };
    engineSuggestion.textContent = t('settings.engine.suggested', { gpu: names[gpu] || 'CPU' });
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
    setModeActive(button.dataset.mode);
    void persist();
  });

  polishGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    setPolishActive(button.dataset.value);
    void persist();
  });

  translationGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    const enabled = button.dataset.value === 'on';
    setTranslationActive(enabled);
    setTranslationUiFromSettings(enabled);
    if (!enabled) clearTranslation();
    void persist();
  });

  aiPolishGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    setAiPolishActive(button.dataset.value === 'on');
    void persist();
  });

  // Changing the UI language applies immediately, then persists; the
  // settings-updated broadcast re-applies it to the overlay as well.
  uiLanguageSelect.addEventListener('change', () => {
    applyLanguageToUi(uiLanguageSelect.value);
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
    if (!key) { showError(t('settings.key.enterDeepgram')); return; }
    deepgramTestBtn.disabled = true;
    deepgramTestBtn.textContent = t('settings.key.testing');
    try {
      await window.api.testDeepgramConnection(key);
      showToast(t('settings.key.connectionSuccessful'));
      void persist();
      void refreshKeyStatus('deepgramApiKey');
      deepgramTestBtn.textContent = t('settings.key.connected');
      setTimeout(() => { deepgramTestBtn.textContent = t('settings.key.testConnection'); }, 2500);
    } catch (error) {
      const friendly = friendlyError(error, 'error.connectionFailed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
      deepgramTestBtn.textContent = t('settings.key.testConnection');
    } finally {
      deepgramTestBtn.disabled = false;
    }
  });

  // Speechmatics test connection
  speechmaticsTestBtn.addEventListener('click', async () => {
    const key = speechmaticsKey.value.trim();
    if (!key) { showError(t('settings.key.enterSpeechmatics')); return; }
    speechmaticsTestBtn.disabled = true;
    speechmaticsTestBtn.textContent = t('settings.key.testing');
    try {
      await window.api.testSpeechmaticsConnection(key);
      showToast(t('settings.key.connectionSuccessful'));
      void persist();
      void refreshKeyStatus('speechmaticsApiKey');
      speechmaticsTestBtn.textContent = t('settings.key.connected');
      setTimeout(() => { speechmaticsTestBtn.textContent = t('settings.key.testConnection'); }, 2500);
    } catch (error) {
      const friendly = friendlyError(error, 'error.connectionFailed');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
      speechmaticsTestBtn.textContent = t('settings.key.testConnection');
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
    showToast(t('settings.key.deepgramRemoved'));
  });

  speechmaticsRemoveKey.addEventListener('click', () => {
    speechmaticsKey.value = '';
    void window.api.deleteSecret('speechmaticsApiKey').catch(() => undefined);
    void persist();
    void refreshKeyStatus('speechmaticsApiKey');
    showToast(t('settings.key.speechmaticsRemoved'));
  });

  selectBinaryBtn.addEventListener('click', async () => {
    try {
      const binaryPath = await window.api.selectWhisperBinary();
      if (binaryPath) {
        currentBinaryPath = binaryPath;
        void persist();
        showBinaryName(binaryPath);
      }
    } catch (error) {
      const friendly = friendlyError(error, 'error.selectBinary');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    }
  });

  recheckBinaryBtn.addEventListener('click', async () => {
    const settings = getSettings();
    if (settings?.whisperBinaryPath) {
      await updateBinaryStatus(settings.whisperBinaryPath);
    } else {
      showError(t('settings.binary.noneSelected'));
    }
  });

  clearBinaryBtn.addEventListener('click', () => {
    // Clearing hands control back: pick any engine button (or Browse again)
    // to choose what transcribes next. The file itself is left on disk.
    currentBinaryPath = '';
    void persist();
    showBinaryName('');
    showToast(t('settings.binary.cleared'));
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
    hotkeyRecord.textContent = t('settings.hotkey.record');
    hotkeyInput.classList.remove('recording');
  }
  hotkeyRecord.addEventListener('click', () => {
    recordingHotkey = !recordingHotkey;
    hotkeyRecord.textContent = recordingHotkey ? t('settings.hotkey.pressKeys') : t('settings.hotkey.record');
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
