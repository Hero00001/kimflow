const fs = require('fs');
const path = require('path');
const os = require('os');
const { AUTO, isKnownLanguage } = require('./languages.cjs');
const { normalizeVocabulary } = require('./vocabulary.cjs');
const { migratePlaintextKeys } = require('./secrets.cjs');

// Tracks whether the most recent load() actually read a config, or fell back to
// defaults because the file was missing / unreadable / corrupt. `ensureUiLanguage`
// uses this to avoid overwriting a real config with defaults on a transient read
// failure (see A1 / F-11).
let lastLoadStatus = 'ok';

const CONFIG_DIR = path.join(os.homedir(), '.kimflow');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.typr');
const LEGACY_CONFIG_PATH = path.join(LEGACY_CONFIG_DIR, 'config.json');
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// The languages the interface can be rendered in. This is the UI language
// only — it is never validated against the STT/translation map in
// languages.cjs and never read by the transcription pipeline.
const UI_LANGUAGES = ['en', 'ar', 'zh'];

const DEFAULT_SETTINGS = {
  microphone: 'default',
  engine: 'local',
  whisperModel: 'small',
  whisperRuntime: 'whisper-cpp',
  whisperBinaryPath: '',
  deepgramApiKey: '',
  // 'auto' is resolved to a concrete nova model per request by
  // backend/engines/deepgram.cjs (resolveDeepgramModel) — nova-3 or nova-2,
  // depending on the input language. See also the whisper migration note in
  // normalizeSettings below.
  deepgramModel: 'auto',
  speechmaticsApiKey: '',
  recordingMode: 'toggle',
  // 'light' is the safe default: it removes fillers/repeats and converts
  // spoken punctuation, but does NOT rewrite sentences. The aggressive
  // 'thorough' mode (word deletion, self-correction restarts) must be an
  // explicit choice — existing users keep whatever they saved.
  polishMode: 'light',
  customVocabulary: [],
  aiPolish: false,
  hotkey: 'CmdOrCtrl+Shift+Space',
  accentColor: '#8b5cf6',
  translationEnabled: false,
  translationProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: '',
  inputLanguage: AUTO,
  inputLanguageMigrated: false,
  translationTarget: 'en',
  // '' means "the user has not chosen yet" and triggers a one-time OS locale
  // detection in main.cjs. It is NOT the same as 'en' (a deliberate English
  // choice), which must never be re-detected back to the OS language.
  uiLanguage: '',
  // Which floating UI to show: the new text-free flow-bar capsule (true) or
  // the legacy text overlay (false). Read in main.cjs at window creation.
  useFlowBarWidget: true,
};

function stringValue(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function coerceHotkey(value) {
  const raw = stringValue(value, DEFAULT_SETTINGS.hotkey);
  // Reject absurdly long inputs before they can be split into millions of
  // parts downstream (see F-12). A valid hotkey is at most a few modifiers
  // plus a key, so anything past 80 chars is not one.
  if (typeof raw !== 'string' || raw.length > 80) return DEFAULT_SETTINGS.hotkey;
  return raw.trim() || DEFAULT_SETTINGS.hotkey;
}

function normalizeSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings && typeof settings === 'object' ? settings : {}) };
  const targetLanguage = isKnownLanguage(merged.translationTarget) && merged.translationTarget !== AUTO
    ? merged.translationTarget
    : DEFAULT_SETTINGS.translationTarget;
  return {
    microphone: stringValue(merged.microphone, DEFAULT_SETTINGS.microphone),
    engine: ['local', 'speechmatics', 'deepgram'].includes(merged.engine) ? merged.engine : DEFAULT_SETTINGS.engine,
    whisperModel: ['tiny', 'base', 'small', 'medium'].includes(merged.whisperModel) ? merged.whisperModel : DEFAULT_SETTINGS.whisperModel,
    whisperRuntime: stringValue(merged.whisperRuntime, DEFAULT_SETTINGS.whisperRuntime),
    whisperBinaryPath: stringValue(merged.whisperBinaryPath, ''),
    deepgramApiKey: stringValue(merged.deepgramApiKey, ''),
    // Stored 'whisper' (a removed model) — and any other unknown value —
    // coerces back to the default 'auto', which resolves to nova-3/nova-2
    // per language at request time. Plain value coercion: idempotent, no
    // migration flag needed.
    deepgramModel: ['auto', 'nova-3', 'nova-2'].includes(merged.deepgramModel)
      ? merged.deepgramModel
      : DEFAULT_SETTINGS.deepgramModel,
    speechmaticsApiKey: stringValue(merged.speechmaticsApiKey, ''),
    recordingMode: ['toggle', 'push-to-talk'].includes(merged.recordingMode) ? merged.recordingMode : DEFAULT_SETTINGS.recordingMode,
    polishMode: ['off', 'light', 'thorough'].includes(merged.polishMode) ? merged.polishMode : DEFAULT_SETTINGS.polishMode,
    customVocabulary: normalizeVocabulary(merged.customVocabulary),
    aiPolish: merged.aiPolish === true,
    hotkey: coerceHotkey(merged.hotkey),
    accentColor: HEX_COLOR.test(merged.accentColor) ? merged.accentColor.toLowerCase() : DEFAULT_SETTINGS.accentColor,
    translationEnabled: merged.translationEnabled === true,
    translationProvider: ['gemini'].includes(merged.translationProvider) ? merged.translationProvider : DEFAULT_SETTINGS.translationProvider,
    geminiApiKey: stringValue(merged.geminiApiKey, ''),
    geminiModel: stringValue(merged.geminiModel, '').trim(),
    inputLanguage: isKnownLanguage(merged.inputLanguage) ? merged.inputLanguage : DEFAULT_SETTINGS.inputLanguage,
    inputLanguageMigrated: merged.inputLanguageMigrated === true,
    translationTarget: targetLanguage,
    // Only the three supported UI languages (or '' = not chosen yet) survive.
    uiLanguage: UI_LANGUAGES.includes(merged.uiLanguage) ? merged.uiLanguage : '',
    // `!== false` (not `=== true`) on purpose: configs written before this key
    // existed must get the new widget, so only an explicit `false` rolls back.
    useFlowBarWidget: merged.useFlowBarWidget !== false,
  };
}

function migrateLegacyData() {
  if (!fs.existsSync(LEGACY_CONFIG_DIR)) return;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  for (const entry of fs.readdirSync(LEGACY_CONFIG_DIR, { withFileTypes: true })) {
    const source = path.join(LEGACY_CONFIG_DIR, entry.name);
    const destination = path.join(CONFIG_DIR, entry.name);
    if (fs.existsSync(destination)) continue;
    try {
      if (entry.isDirectory()) fs.cpSync(source, destination, { recursive: true });
      else fs.copyFileSync(source, destination);
    } catch {
      // A missing legacy model/config must not prevent KimFlow from starting.
    }
  }
}

function migrateInputLanguageToAuto(settings) {
  // Older saved configs forced 'en' as the input/STT language, which made
  // Deepgram reject non-English speech. Reset such a stored value to Auto
  // Detect exactly once, then persist the marker: without it, this reset
  // would also swallow a deliberate English selection on every launch.
  if (settings && typeof settings === 'object'
    && settings.inputLanguage === 'en' && !settings.inputLanguageMigrated) {
    settings.inputLanguage = AUTO;
    settings.inputLanguageMigrated = true;
    return true;
  }
  return false;
}

function load() {
  try {
    migrateLegacyData();
    const sourcePath = fs.existsSync(CONFIG_PATH)
      ? CONFIG_PATH
      : fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null;
    if (sourcePath) {
      const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      const languageReset = migrateInputLanguageToAuto(raw);
      const { settings: migratedSettings, migrated } = migratePlaintextKeys(raw);
      const normalized = normalizeSettings(migratedSettings);
      // Persist whenever a migration rewrote the stored config: the
      // language reset must land on disk or it would replay every launch.
      if (migrated || languageReset) {
        try {
          save(normalized);
        } catch {
          // A read-only config must never break startup.
        }
      }
      lastLoadStatus = 'ok';
      return normalized;
    }
    // No config file yet — defaults are the correct baseline (first run).
    lastLoadStatus = 'missing';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error && error.code === 'EACCES') {
      // A locked / temporarily-unreadable config must NEVER be overwritten with
      // defaults — that would destroy the user's real settings (A1 / F-11).
      lastLoadStatus = 'read-error';
    } else if (/JSON|SyntaxError|Unexpected/i.test(message)) {
      // Corrupt config: fall back to the last-good backup before giving up.
      try {
        const backupPath = `${CONFIG_PATH}.bak`;
        if (fs.existsSync(backupPath)) {
          const raw = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
          const { settings: migratedSettings } = migratePlaintextKeys(raw);
          lastLoadStatus = 'recovered';
          return normalizeSettings(migratedSettings);
        }
      } catch {}
      lastLoadStatus = 'corrupt';
    } else {
      lastLoadStatus = 'read-error';
    }
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * The outcome of the most recent load(): one of
 * - 'ok'         a config was read and normalized
 * - 'missing'    no config file exists yet (first run)
 * - 'recovered'  the config was corrupt but a `.bak` was used instead
 * - 'read-error' the config could not be read (locked / transient error)
 * - 'corrupt'    the config was unparseable and no `.bak` was available
 *
 * `ensureUiLanguage` uses this to avoid persisting defaults over a real config
 * on a transient read failure.
 */
function getLoadStatus() {
  return lastLoadStatus;
}

function save(settings) {
  try {
    migrateLegacyData();
  } catch {
    // A broken legacy dir must never prevent saving current settings.
  }
  const { settings: migratedInput } = migratePlaintextKeys(settings && typeof settings === 'object' ? settings : {});
  const normalized = normalizeSettings(migratedInput);
  normalized.deepgramApiKey = '';
  normalized.speechmaticsApiKey = '';
  normalized.geminiApiKey = '';
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), 'utf8');
  const previousPath = `${CONFIG_PATH}.previous`;
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      // Keep the pre-save config as a rollback point AND as the `.bak` that
      // load() falls back to on a future parse failure. The atomic swap never
      // deletes the only copy: if the final rename fails we restore `previous`.
      try { fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak`); } catch {}
      try { fs.rmSync(previousPath, { force: true }); } catch {}
      fs.renameSync(CONFIG_PATH, previousPath);
    }
    fs.renameSync(tempPath, CONFIG_PATH);
    try { fs.rmSync(previousPath, { force: true }); } catch {}
  } catch (error) {
    // The swap failed: restore the previous config if we moved it aside, and
    // never leave the only copy deleted.
    try {
      if (fs.existsSync(previousPath)) {
        fs.rmSync(tempPath, { force: true });
        fs.renameSync(previousPath, CONFIG_PATH);
      }
    } catch {}
    throw error;
  }
  return normalized;
}

const SECRET_KEYS = ['deepgramApiKey', 'speechmaticsApiKey', 'geminiApiKey'];

/**
 * Return a copy of `settings` with the three secret values blanked, so they
 * never reach the renderer. Used for IPC responses (get-settings,
 * settings-updated) — the main process keeps reading the real values from the
 * secret store, the renderer never needs them.
 */
function blankSecretValues(settings) {
  if (!settings || typeof settings !== 'object') return settings;
  const out = { ...settings };
  for (const name of SECRET_KEYS) out[name] = '';
  return out;
}

module.exports = {
  load,
  save,
  normalizeSettings,
  CONFIG_DIR,
  DEFAULT_SETTINGS,
  getLoadStatus,
  blankSecretValues,
  loadSettings: load,
  saveSettings: save,
};
