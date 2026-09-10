const fs = require('fs');
const path = require('path');
const os = require('os');
const { AUTO, isKnownLanguage } = require('./languages.cjs');
const { normalizeVocabulary } = require('./vocabulary.cjs');
const { migratePlaintextKeys } = require('./secrets.cjs');

const CONFIG_DIR = path.join(os.homedir(), '.kimflow');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.typr');
const LEGACY_CONFIG_PATH = path.join(LEGACY_CONFIG_DIR, 'config.json');
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const DEFAULT_SETTINGS = {
  microphone: 'default',
  engine: 'local',
  whisperModel: 'small',
  whisperRuntime: 'whisper-cpp',
  whisperBinaryPath: '',
  deepgramApiKey: '',
  deepgramModel: 'nova-3',
  speechmaticsApiKey: '',
  recordingMode: 'toggle',
  polishMode: 'thorough',
  customVocabulary: [],
  hotkey: 'CmdOrCtrl+Shift+Space',
  accentColor: '#8b5cf6',
  translationEnabled: false,
  translationProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: '',
  inputLanguage: AUTO,
  translationTarget: 'en',
};

function stringValue(value, fallback) {
  return typeof value === 'string' ? value : fallback;
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
    deepgramModel: ['nova-3', 'nova-2', 'whisper'].includes(merged.deepgramModel) ? merged.deepgramModel : DEFAULT_SETTINGS.deepgramModel,
    speechmaticsApiKey: stringValue(merged.speechmaticsApiKey, ''),
    recordingMode: ['toggle', 'push-to-talk'].includes(merged.recordingMode) ? merged.recordingMode : DEFAULT_SETTINGS.recordingMode,
    polishMode: ['off', 'light', 'thorough'].includes(merged.polishMode) ? merged.polishMode : DEFAULT_SETTINGS.polishMode,
    customVocabulary: normalizeVocabulary(merged.customVocabulary),
    hotkey: stringValue(merged.hotkey, DEFAULT_SETTINGS.hotkey).trim() || DEFAULT_SETTINGS.hotkey,
    accentColor: HEX_COLOR.test(merged.accentColor) ? merged.accentColor.toLowerCase() : DEFAULT_SETTINGS.accentColor,
    translationEnabled: merged.translationEnabled === true,
    translationProvider: ['gemini'].includes(merged.translationProvider) ? merged.translationProvider : DEFAULT_SETTINGS.translationProvider,
    geminiApiKey: stringValue(merged.geminiApiKey, ''),
    geminiModel: stringValue(merged.geminiModel, '').trim(),
    inputLanguage: isKnownLanguage(merged.inputLanguage) ? merged.inputLanguage : DEFAULT_SETTINGS.inputLanguage,
    translationTarget: targetLanguage,
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
  // Older Saved configs forced 'en' as the input/STT language, which made
  // Deepgram reject non-English speech. Reset such a stored value to Auto
  // Detect once; a user selecting English explicitly afterwards is preserved.
  if (settings && typeof settings === 'object' && settings.inputLanguage === 'en') {
    settings.inputLanguage = AUTO;
  }
  return settings;
}

function load() {
  try {
    migrateLegacyData();
    const sourcePath = fs.existsSync(CONFIG_PATH)
      ? CONFIG_PATH
      : fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null;
    if (sourcePath) {
      const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
      const { settings: migratedSettings, migrated } = migratePlaintextKeys(migrateInputLanguageToAuto(raw));
      const normalized = normalizeSettings(migratedSettings);
      if (migrated) {
        try {
          save(normalized);
        } catch {
          // A read-only config must never break startup.
        }
      }
      return normalized;
    }
  } catch {
    // Fall back to safe defaults when the file is missing or malformed.
  }
  return { ...DEFAULT_SETTINGS };
}

function save(settings) {
  migrateLegacyData();
  const { settings: migratedInput } = migratePlaintextKeys(settings && typeof settings === 'object' ? settings : {});
  const normalized = normalizeSettings(migratedInput);
  normalized.deepgramApiKey = '';
  normalized.speechmaticsApiKey = '';
  normalized.geminiApiKey = '';
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const tempPath = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2), 'utf8');
  try {
    fs.renameSync(tempPath, CONFIG_PATH);
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.renameSync(tempPath, CONFIG_PATH);
  }
  return normalized;
}

module.exports = {
  load,
  save,
  normalizeSettings,
  CONFIG_DIR,
  DEFAULT_SETTINGS,
  loadSettings: load,
  saveSettings: save,
};
