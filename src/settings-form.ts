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
  geminiRemoveKey,
  geminiKeyStatus,
  geminiKeyStatusRow,
  geminiModel,
  hotkeyInput,
  hotkeyRecord,
  pauseHotkeyInput,
  pauseHotkeyRecord,
  accentColor,
  uiLanguageSelect,
  themeSelect,
  engineGroup,
  localEngineRow,
  localEngineGroup,
  localEngineStatus,
  localRow,
  speechmaticsRow,
  deepgramRow,
  modeGroup,
  polishGroup,
  vocabInput,
  vocabChips,
  vocabCount,
  vocabLimitNote,
  settingsNav,
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
import { applyAccentColor, applyTheme, normalizeThemeSetting } from './theme';
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

let persistTimer: number | undefined;

/** Deepgram models the model select offers; anything else resolves to 'auto'. */
const DEEPGRAM_MODEL_VALUES: ReadonlySet<string> = new Set(['auto', 'nova-3', 'nova-2']);

/**
 * Maximum custom vocabulary terms. backend/vocabulary.cjs owns MAX_TERMS
 * (and slices the stored list server-side); it is not exposed over IPC, so
 * the renderer mirrors the constant here for the count UI. Keep in sync.
 */
const MAX_VOCAB_TERMS = 100;

/**
 * Whisper model options for #model-select, in display order. The select is
 * re-populated from here whenever the local engine flavor changes; options
 * carry data-i18n so renderStatic re-translates them like the static markup
 * used to.
 */
const WHISPER_MODEL_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: 'tiny', labelKey: 'settings.model.tiny' },
  { value: 'base', labelKey: 'settings.model.base' },
  { value: 'small', labelKey: 'settings.model.small' },
  { value: 'medium', labelKey: 'settings.model.medium' },
];

/**
 * SenseVoice registry entry (backend/model-download.cjs). Honest label:
 * languages + size. One entry for now; more registry ids would go here.
 */
const SENSE_VOICE_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: 'sense-voice-int8', labelKey: 'settings.model.senseVoice' },
];

/** Populate #model-select with the option set for the given local engine. */
function populateModelOptions(localEngine: string): void {
  const options = localEngine === 'sherpa-onnx' ? SENSE_VOICE_OPTIONS : WHISPER_MODEL_OPTIONS;
  const elements = options.map(({ value, labelKey }) => {
    const option = document.createElement('option');
    option.value = value;
    option.setAttribute('data-i18n', labelKey);
    option.textContent = t(labelKey);
    return option;
  });
  modelSelect.replaceChildren(...elements);
}

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
  'engine' | 'recordingMode' | 'polishMode' | 'translationEnabled' | 'aiPolish' | 'whisperBinaryPath' | 'localEngine'
> {
  return {
    engine: activeToggleValue(engineGroup, 'value') || 'local',
    recordingMode: activeToggleValue(modeGroup, 'mode') || 'toggle',
    polishMode: activeToggleValue(polishGroup, 'value') || 'light',
    translationEnabled: activeToggleValue(translationGroup, 'value') === 'on',
    aiPolish: activeToggleValue(aiPolishGroup, 'value') === 'on',
    whisperBinaryPath: currentBinaryPath,
    localEngine: currentLocalEngine(),
  };
}

/**
 * Write settings to the shared store without letting a server snapshot undo
 * the values the settings form owns.
 */
function setOwnedSettings(settings: Settings): void {
  setSettings({ ...settings, ...ownedSettings() });
}

/**
 * Change the custom binary in effect.
 *
 * The store is updated too, so it never holds a path that is no longer the
 * one in use — "Recheck" validates the store's path, and a stale one made it
 * report a false failure next to the engine that had just been installed.
 */
function setCurrentBinaryPath(path: string): void {
  currentBinaryPath = path;
  const settings = getSettings();
  if (settings) setSettings({ ...settings, whisperBinaryPath: path });
}

function schedulePersist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => { void persist(); }, 500);
}

// Modifier key names match the physical keycaps, so they are never translated.
function isWindows(): boolean {
  return /win/i.test(navigator.platform || navigator.userAgent);
}

function formatHotkey(hotkey: string) {
  return hotkey.replace(/CmdOrCtrl|CommandOrControl/g, isWindows() ? 'Ctrl' : 'Cmd');
}

/** Drive the `:empty::after` placeholders, which cannot carry data-i18n. */
function applyEmptyStateText() {
  const root = document.documentElement;
  root.style.setProperty('--i18n-empty-transcript', cssContentValue(t('transcribe.empty')));
  root.style.setProperty('--i18n-empty-translation', cssContentValue(t('translation.empty')));
}

/** Parse the textarea's raw value into terms (mirrors persist() semantics). */
function parseVocabTerms(): string[] {
  return vocabInput.value.split('\n').map((line) => line.trim()).filter(Boolean);
}

/**
 * Render one removable chip per parsed term above the textarea (retheme #09).
 * The textarea stays the editing surface, so multi-line paste and every
 * existing listener keep working; chips are a view over its value. Removing
 * a chip deletes that line from the textarea and persists immediately.
 */
function renderVocabChips(): void {
  const terms = parseVocabTerms();
  const chips: Array<HTMLElement> = [];
  terms.forEach((term, index) => {
    const chip = document.createElement('span');
    chip.className = 'vocab-chip';
    const label = document.createElement('span');
    label.className = 'vocab-chip-term';
    label.textContent = term;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'vocab-chip-remove';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', t('settings.output.removeTerm'));
    remove.addEventListener('click', () => {
      const lines = vocabInput.value.split('\n');
      lines.splice(index, 1);
      vocabInput.value = lines.join('\n');
      renderVocabChips();
      updateVocabCount();
      void persist();
    });
    chip.append(label, remove);
    chips.push(chip);
  });
  vocabChips.replaceChildren(...chips);
}

/** `n / MAX_TERMS` count plus the visible over-limit note (retheme #09). */
function updateVocabCount(): void {
  const count = parseVocabTerms().length;
  vocabCount.textContent = t('settings.output.vocabCount', { count, max: MAX_VOCAB_TERMS });
  vocabLimitNote.classList.toggle('hidden', count <= MAX_VOCAB_TERMS);
}

/** Refresh the vocab affordances after any textarea/language change. */
function refreshVocabUi(): void {
  renderVocabChips();
  updateVocabCount();
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
  refreshVocabUi();
  void refreshSherpaStatus();
  // renderStatic re-applies every `data-i18n` attribute, which resets the
  // key-status spans to their "No key saved" placeholder — even when a key
  // IS stored. Re-derive them from the OS keychain after each re-render.
  refreshAllKeyStatus();
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
  currentEngineValue = engine;
  localRow.classList.toggle('hidden', engine !== 'local');
  refreshLocalEngineRowVisibility();
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

/** The engine the UI is currently showing (may be ahead of the store). */
let currentEngineValue = 'local';

/** The local-engine flavor currently shown by its toggle group. */
function currentLocalEngine(): string {
  return activeToggleValue(localEngineGroup, 'value') || 'whisper-cpp';
}

/** #local-engine-row shows only for the local engine, and only on Windows. */
function refreshLocalEngineRowVisibility(): void {
  const show = currentEngineValue === 'local' && isWindowsEngineHost();
  localEngineRow.classList.toggle('hidden', !show);
}

/** Whisper-specific rows (flavor downloads, suggestion, custom binary) — the sherpa sidecar has none of them. */
function refreshWhisperOnlyRows(): void {
  const sherpa = currentLocalEngine() === 'sherpa-onnx';
  const show = isWindowsEngineHost() && !sherpa;
  document.getElementById('engine-download-row')?.classList.toggle('hidden', !show);
  document.getElementById('engine-suggestion-row')?.classList.toggle('hidden', !show);
  localRow.querySelector('.engine-setup-section')?.classList.toggle('hidden', sherpa);
}

/**
 * SenseVoice readiness note (ticket 05): visible fallback explanation when
 * the sidecar or model is missing, ready-state otherwise. Never fakes
 * readiness — an unknown status shows the fallback note.
 */
async function refreshSherpaStatus(): Promise<void> {
  if (currentLocalEngine() !== 'sherpa-onnx') {
    localEngineStatus.classList.add('hidden');
    return;
  }
  try {
    const status = await window.api.sherpaStatus();
    localEngineStatus.textContent = status.runtime && status.model
      ? t('settings.download.ready')
      : t('settings.localEngine.fallbackNote');
  } catch {
    localEngineStatus.textContent = t('settings.localEngine.fallbackNote');
  }
  localEngineStatus.classList.remove('hidden');
}

/**
 * Switch the local engine flavor: retarget the toggle group, repopulate the
 * model select for that flavor, restore the right model value, and refresh
 * whisper-only row visibility + the readiness note.
 */
function setLocalEngine(value: string): void {
  const next = value === 'sherpa-onnx' ? 'sherpa-onnx' : 'whisper-cpp';
  localEngineGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === next);
  });
  populateModelOptions(next);
  modelSelect.value = next === 'sherpa-onnx'
    ? 'sense-voice-int8'
    : (getSettings()?.whisperModel || 'small');
  refreshWhisperOnlyRows();
  void refreshSherpaStatus();
  void checkModelStatus();
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
  const inputs = {
    deepgramApiKey: deepgramKey,
    speechmaticsApiKey: speechmaticsKey,
    geminiApiKey: geminiKey,
  } as const;
  let state = 'unavailable';
  try {
    state = await window.api.secretState(name);
    targets[name].textContent = state === 'saved'
      ? t('settings.key.saved')
      : state === 'volatile'
        ? t('settings.key.volatile')
        : state === 'unreadable'
          ? t('settings.key.unreadable')
          : t('settings.key.none');
  } catch {
    state = 'unavailable';
    targets[name].textContent = t('settings.key.unavailable');
  }
  applyKeyPlaceholder(inputs[name], state);
}

/**
 * Mirror the key status into the input's placeholder.
 *
 * The static "Enter your … API key" placeholder reads as broken next to a
 * "Key saved" status, so a stored/volatile/unreadable key shows the status
 * text in the field instead. With no key (or an unavailable status service)
 * the original static placeholder from index.html is restored via its
 * `data-i18n-placeholder` key, exactly the way `renderStatic()` re-applies it.
 *
 * Cosmetic only — must never throw, and reuses existing i18n keys.
 */
function applyKeyPlaceholder(input: HTMLInputElement, state: string): void {
  try {
    if (state === 'saved' || state === 'volatile' || state === 'unreadable') {
      input.placeholder = t(state === 'saved'
        ? 'settings.key.saved'
        : state === 'volatile'
          ? 'settings.key.volatile'
          : 'settings.key.unreadable');
      return;
    }
    // missing / unavailable: restore the original static placeholder.
    const placeholderKey = input.dataset.i18nPlaceholder;
    if (placeholderKey) input.placeholder = t(placeholderKey);
  } catch {
    // A placeholder is decoration; a failure here must never affect the
    // status text above.
  }
}

function refreshAllKeyStatus() {
  void refreshKeyStatus('deepgramApiKey');
  void refreshKeyStatus('speechmaticsApiKey');
  void refreshKeyStatus('geminiApiKey');
}

export async function loadSettingsIntoUi(settings: Settings): Promise<void> {
  setSettings(settings);
  setCurrentBinaryPath(settings.whisperBinaryPath || '');
  uiLanguageSelect.value = normalizeUILanguage(settings.uiLanguage);
  applyLanguageToUi(settings.uiLanguage);
  setEngine(settings.engine);
  // Local engine flavor: sets the toggle, populates #model-select for that
  // flavor and selects the right model value (whisper model or SenseVoice).
  setLocalEngine(settings.localEngine === 'sherpa-onnx' ? 'sherpa-onnx' : 'whisper-cpp');
  showBinaryName(settings.whisperBinaryPath || '');
  // The key inputs are write-only: the backend blanks key fields before
  // returning them, so populating these from a settings payload could only
  // ever erase what the user typed. The key-status indicator below is what
  // tells the user a key is stored.
  // An unknown or legacy stored value ('whisper', …) must not point the
  // select at a nonexistent option — map it back to 'auto', which the
  // backend resolves to a concrete nova model at request time.
  deepgramModelSelect.value = DEEPGRAM_MODEL_VALUES.has(settings.deepgramModel) ? settings.deepgramModel : 'auto';
  setModeActive(settings.recordingMode);
  setPolishActive(settings.polishMode || 'light');
  vocabInput.value = (settings.customVocabulary || []).join('\n');
  refreshVocabUi();
  setAiPolishActive(settings.aiPolish === true);
  // The translation toggle's active class is owned by this form (the
  // translation module must not re-derive it from a possibly stale snapshot),
  // so it is set here on first load.
  setTranslationActive(settings.translationEnabled === true);
  hotkeyInput.value = settings.hotkey;
  hotkeyInput.title = formatHotkey(settings.hotkey);
  hotkeyDisplay.textContent = formatHotkey(settings.hotkey);
  // The pause hotkey is optional: '' means disabled and must be preserved
  // verbatim — unlike the capture hotkey, there is no fallback to another
  // value when the field is empty.
  pauseHotkeyInput.value = settings.pauseHotkey || '';
  pauseHotkeyInput.title = formatHotkey(settings.pauseHotkey || '');
  accentColor.value = settings.accentColor;
  // Initialize the select from the saved setting BEFORE any persist can read
  // it: runPersist writes normalizeThemeSetting(themeSelect.value), and an
  // uninitialized select reports its first option ('system'), which silently
  // rewrote the user's theme on the next unrelated persist (e.g. an engine
  // change) and flipped the UI when the OS preference differs.
  themeSelect.value = normalizeThemeSetting(settings.theme);
  // Theme first, accent second — see the ordering note in theme.ts. The
  // accent defaults live in the active theme's stylesheet block, and the
  // runtime accent overwrite must land on top of the freshly applied theme.
  applyTheme(settings.theme);
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
  // The .catch is essential: ONE rejected runPersist used to poison the
  // chain, silently discarding every settings change for the rest of the
  // session (#09).
  persistChain = persistChain.then(runPersist).catch((error) => {
    const friendly = friendlyError(error, 'error.saveSettings');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  });
}

async function runPersist(): Promise<void> {
  const settings = getSettings();
  if (!settings) return;
  // The model select shows the SenseVoice entry when the local engine flavor
  // is sherpa-onnx; only a whisper selection may write whisperModel.
  settings.microphone = micSelect.value || 'default';
  if (currentLocalEngine() !== 'sherpa-onnx') settings.whisperModel = modelSelect.value;
  settings.whisperRuntime = 'whisper-cpp';
  // API keys are trimmed: keys pasted from an email or a website often carry
  // a trailing newline, and a stored "key\n" is rejected by the provider in
  // a way that looks exactly like "no key saved".
  settings.deepgramApiKey = deepgramKey.value.trim();
  settings.deepgramModel = deepgramModelSelect.value;
  settings.speechmaticsApiKey = speechmaticsKey.value.trim();
  settings.translationProvider = providerSelect.value || 'gemini';
  settings.inputLanguage = inputLanguageSelect.value || 'auto';
  settings.translationTarget = translateToSelect.value || 'en';
  settings.geminiApiKey = geminiKey.value.trim();
  settings.geminiModel = geminiModel.value.trim();
  settings.customVocabulary = vocabInput.value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, MAX_VOCAB_TERMS);
  settings.hotkey = hotkeyInput.value.trim() || settings.hotkey;
  // The pause hotkey has NO empty-fallback: clearing the field is how the
  // hotkey is disabled, so '' must reach the backend as-is.
  settings.pauseHotkey = pauseHotkeyInput.value.trim();
  settings.accentColor = accentColor.value;
  settings.theme = normalizeThemeSetting(themeSelect.value);
  // The UI language is independent of inputLanguage / translationTarget:
  // it only changes how the interface renders.
  settings.uiLanguage = uiLanguageSelect.value || settings.uiLanguage;
  // The six settings with no form control are read from the UI, not from the
  // shared settings object: the object is replaced by every save response and
  // broadcast, and those snapshots can predate the user's latest change.
  Object.assign(settings, ownedSettings());
  // Theme first, accent second — see the ordering note in theme.ts.
  applyTheme(settings.theme);
  applyAccentColor(settings.accentColor);
  try {
    const saved = await window.api.saveSettings(settings);
    setOwnedSettings(saved);
    refreshAllKeyStatus();
    // The read-only hotkey display follows the saved hotkey. It used to be
    // refreshed by the settings broadcast, but the broadcast no longer
    // applies a snapshot over the editable controls — so it would keep
    // showing the previous hotkey until the app restarted.
    hotkeyDisplay.textContent = formatHotkey(saved.hotkey);
    // Keep the fields honest about what is actually in effect: when the
    // requested pause hotkey could not be claimed, the backend restored the
    // previous one (or disabled it) and saved that value.
    hotkeyInput.value = saved.hotkey;
    hotkeyInput.title = formatHotkey(saved.hotkey);
    pauseHotkeyInput.value = saved.pauseHotkey || '';
    pauseHotkeyInput.title = formatHotkey(saved.pauseHotkey || '');
  } catch (error) {
    const friendly = friendlyError(error, 'error.saveSettings');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
    // The hotkey that is actually in effect is in the store — the broadcast
    // that carried it was delivered before the rejection — so the input must
    // show that rather than the shortcut that could not be claimed.
    const effective = getSettings()?.hotkey;
    if (effective && effective !== hotkeyInput.value) {
      hotkeyInput.value = effective;
      hotkeyDisplay.textContent = formatHotkey(effective);
    }
    // Same honesty rule for the pause hotkey after a failed save.
    const effectivePause = getSettings()?.pauseHotkey;
    if (typeof effectivePause === 'string' && effectivePause !== pauseHotkeyInput.value) {
      pauseHotkeyInput.value = effectivePause;
      pauseHotkeyInput.title = formatHotkey(effectivePause);
    }
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
  // Model and engine downloads share one channel (#17): ignore progress that
  // does not belong to the download whose label is showing.
  if (progress.kind && activeDownloadKind && progress.kind !== activeDownloadKind) return;
  const percent = Math.max(0, Math.min(100, progress.percent));
  progressFill.style.width = `${percent}%`;
  downloadLabel.textContent = activeDownloadLabel ? `${activeDownloadLabel}… ${Math.round(percent)}%` : '';
}

let activeDownloadLabel = '';
let activeDownloadKind: 'model' | 'engine' | '' = '';

function showDownloadProgress(label: string, kind: 'model' | 'engine') {
  activeDownloadLabel = label;
  activeDownloadKind = kind;
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
    // Label from the option text so a registry entry (SenseVoice-Small ·
    // zh/yue/ja/ko · 155 MB) does not render as a raw id in the progress bar.
    const modelLabel = modelSelect.selectedOptions[0]?.textContent || modelSelect.value;
    showDownloadProgress(t('settings.model.downloading', { model: modelLabel }), 'model');
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
  return isWindows();
}

function applyEngineWindowsGate(): void {
  refreshLocalEngineRowVisibility();
  refreshWhisperOnlyRows();
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
      setCurrentBinaryPath(exePath);
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
  showDownloadProgress(t('settings.engine.downloading', { flavor }), 'engine');
  try {
    const exePath = await window.api.downloadEngine(flavor);
    setCurrentBinaryPath(exePath);
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

/**
 * Wire one hotkey editor: a text input plus a "Record" button that captures
 * the next key combination. The capture and pause hotkey editors share the
 * same behaviour; they differ only in the persistence rules around them
 * (the capture hotkey falls back when emptied, the pause hotkey does not).
 */
function wireHotkeyEditor(input: HTMLInputElement, recordButton: HTMLButtonElement): void {
  let recording = false;
  const stopRecording = () => {
    recording = false;
    recordButton.textContent = t('settings.hotkey.record');
    input.classList.remove('recording');
  };
  recordButton.addEventListener('click', () => {
    recording = !recording;
    recordButton.textContent = recording ? t('settings.hotkey.pressKeys') : t('settings.hotkey.record');
    input.classList.toggle('recording', recording);
    if (recording) input.focus();
  });
  input.addEventListener('keydown', (event) => {
    if (!recording) return;
    event.preventDefault();
    // Escape or focus loss cancels capture instead of sticking on "Press keys…".
    if (event.key === 'Escape') { stopRecording(); return; }
    const modifiers = [
      event.ctrlKey ? 'Ctrl' : '',
      // The meta key is the Command key on macOS and the Super/Windows key
      // elsewhere. Electron documents that the "Command" modifier has no effect
      // on Windows and Linux, so emitting it there would bind the bare key.
      event.metaKey ? (isWindows() ? 'Super' : 'Command') : '',
      event.altKey ? 'Alt' : '',
      event.shiftKey ? 'Shift' : '',
    ].filter(Boolean);
    const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) {
      input.value = [...modifiers, key].join('+');
      // The compact key-cap box may clip a long value; the tooltip always
      // carries the full combination.
      input.title = formatHotkey(input.value);
      stopRecording();
      void persist();
    }
  });
  input.addEventListener('blur', () => {
    if (recording) stopRecording();
  });
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

  // Local engine flavor (whisper.cpp vs SenseVoice): applies immediately,
  // then persists. runPersist guards whisperModel against the sherpa select.
  localEngineGroup.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('.toggle-btn') as HTMLElement | null;
    if (!button?.dataset.value) return;
    setLocalEngine(button.dataset.value);
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

  // Changing the theme applies immediately (light/dark pin explicitly,
  // system follows the OS live), then persists. runPersist re-applies both
  // theme and accent in the documented order on every save.
  themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value);
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
  // The chips are a live view of the textarea; re-render on every keystroke.
  vocabInput.addEventListener('change', () => { void persist(); });
  vocabInput.addEventListener('input', () => { refreshVocabUi(); schedulePersist(); });

  // Chip-style section nav (retheme #03). Chips toggle: a collapsed target
  // opens and scrolls into view; an open target collapses, so a second click
  // behaves like the summary itself instead of pinning the section open.
  settingsNav.querySelectorAll<HTMLButtonElement>('.settings-nav-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const target = document.getElementById(chip.dataset.section || '');
      if (!(target instanceof HTMLDetailsElement)) return;
      if (target.open) {
        target.open = false;
        return;
      }
      target.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
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

  // Remove API keys. The deletion must complete before the status refresh,
  // otherwise the indicator is re-read from a keychain that still holds the
  // key and reports it as saved right after the user removed it.
  deepgramRemoveKey.addEventListener('click', async () => {
    deepgramKey.value = '';
    try { await window.api.deleteSecret('deepgramApiKey'); } catch { /* best-effort */ }
    void persist();
    refreshKeyStatus('deepgramApiKey');
    showToast(t('settings.key.deepgramRemoved'));
  });

  speechmaticsRemoveKey.addEventListener('click', async () => {
    speechmaticsKey.value = '';
    try { await window.api.deleteSecret('speechmaticsApiKey'); } catch { /* best-effort */ }
    void persist();
    refreshKeyStatus('speechmaticsApiKey');
    showToast(t('settings.key.speechmaticsRemoved'));
  });

  // The Gemini key used to have no remove affordance at all: clearing the
  // field left the stored secret alive, so "removed" was a lie (#23).
  geminiRemoveKey.addEventListener('click', async () => {
    geminiKey.value = '';
    try { await window.api.deleteSecret('geminiApiKey'); } catch { /* best-effort */ }
    void persist();
    refreshKeyStatus('geminiApiKey');
    showToast(t('settings.key.geminiRemoved'));
  });

  selectBinaryBtn.addEventListener('click', async () => {
    try {
      const binaryPath = await window.api.selectWhisperBinary();
      if (binaryPath) {
        setCurrentBinaryPath(binaryPath);
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
    setCurrentBinaryPath('');
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
  pauseHotkeyInput.addEventListener('change', () => { void persist(); });
  wireHotkeyEditor(hotkeyInput, hotkeyRecord);
  wireHotkeyEditor(pauseHotkeyInput, pauseHotkeyRecord);

  wireDownload();
}
