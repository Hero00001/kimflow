const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.kimflow');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const LEGACY_CONFIG_DIR = path.join(os.homedir(), '.typr');
const LEGACY_CONFIG_PATH = path.join(LEGACY_CONFIG_DIR, 'config.json');
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const DEFAULT_SETTINGS = {
  microphone: 'default',
  engine: 'local',
  whisperModel: 'small',
  deepgramApiKey: '',
  groqApiKey: '',
  recordingMode: 'toggle',
  hotkey: 'CmdOrCtrl+Shift+Space',
  accentColor: '#8b5cf6',
};

function stringValue(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function normalizeSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings && typeof settings === 'object' ? settings : {}) };
  return {
    microphone: stringValue(merged.microphone, DEFAULT_SETTINGS.microphone),
    engine: ['local', 'groq', 'deepgram'].includes(merged.engine) ? merged.engine : DEFAULT_SETTINGS.engine,
    whisperModel: ['small', 'medium'].includes(merged.whisperModel) ? merged.whisperModel : DEFAULT_SETTINGS.whisperModel,
    deepgramApiKey: stringValue(merged.deepgramApiKey, ''),
    groqApiKey: stringValue(merged.groqApiKey, ''),
    recordingMode: ['toggle', 'push-to-talk'].includes(merged.recordingMode) ? merged.recordingMode : DEFAULT_SETTINGS.recordingMode,
    hotkey: stringValue(merged.hotkey, DEFAULT_SETTINGS.hotkey).trim() || DEFAULT_SETTINGS.hotkey,
    accentColor: HEX_COLOR.test(merged.accentColor) ? merged.accentColor.toLowerCase() : DEFAULT_SETTINGS.accentColor,
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

function load() {
  try {
    migrateLegacyData();
    const sourcePath = fs.existsSync(CONFIG_PATH)
      ? CONFIG_PATH
      : fs.existsSync(LEGACY_CONFIG_PATH) ? LEGACY_CONFIG_PATH : null;
    if (sourcePath) {
      return normalizeSettings(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
    }
  } catch {
    // Fall back to safe defaults when the file is missing or malformed.
  }
  return { ...DEFAULT_SETTINGS };
}

function save(settings) {
  migrateLegacyData();
  const normalized = normalizeSettings(settings);
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
