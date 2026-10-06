const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG_DIR } = require('./settings.cjs');

const HISTORY_PATH = path.join(CONFIG_DIR, 'history.json');
const MAX_ENTRIES = 100;

function emptyHistory() {
  return { sessions: [] };
}

function load() {
  // A corrupt main file falls back to the previous good generation before
  // giving up to empty — one bad byte must not discard the whole history.
  for (const candidate of [HISTORY_PATH, `${HISTORY_PATH}.bak`]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed && Array.isArray(parsed.sessions)) return parsed;
    } catch {
      // Try the backup next, then fall back to an empty history.
    }
  }
  return emptyHistory();
}

function save(history) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  // Rotate the last good file aside first: a crash between write and rename
  // must never leave corruption as the only copy on disk.
  try {
    if (fs.existsSync(HISTORY_PATH)) fs.copyFileSync(HISTORY_PATH, `${HISTORY_PATH}.bak`);
  } catch {
    // Backup is best-effort; the atomic write below is the real guarantee.
  }
  const tempPath = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(history, null, 2), 'utf8');
  try {
    fs.renameSync(tempPath, HISTORY_PATH);
  } catch (error) {
    if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
    fs.rmSync(HISTORY_PATH, { force: true });
    fs.renameSync(tempPath, HISTORY_PATH);
  }
  return history;
}

function titleFromText(text) {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled';
  const shortened = cleaned.length > 40 ? `${cleaned.slice(0, 40).trimEnd()}…` : cleaned;
  return shortened;
}

function addSession({ text, durationMs, createdAt, translation, translationTarget, translationError }) {
  const history = load();
  const entry = {
    id: crypto.randomUUID(),
    text: text || '',
    title: titleFromText(text),
    createdAt: createdAt || Date.now(),
    durationMs: durationMs || 0,
  };
  if (translation) entry.translation = translation;
  if (translationTarget) entry.translationTarget = translationTarget;
  if (translationError) entry.translationError = translationError;
  history.sessions.unshift(entry);
  if (history.sessions.length > MAX_ENTRIES) {
    history.sessions = history.sessions.slice(0, MAX_ENTRIES);
  }
  save(history);
  return entry;
}

// Patches translation onto an existing entry once translation completes
// (history is saved before Gemini finishes, so the entry is updated late).
function updateSession(id, { translation, translationTarget, translationError } = {}) {
  const history = load();
  const entry = history.sessions.find((session) => session.id === id);
  if (!entry) return null;
  if (translation !== undefined) {
    if (translation) entry.translation = translation;
    else delete entry.translation;
  }
  if (translationTarget !== undefined) {
    if (translationTarget) entry.translationTarget = translationTarget;
    else delete entry.translationTarget;
  }
  if (translationError !== undefined) {
    if (translationError) entry.translationError = translationError;
    else delete entry.translationError;
  }
  save(history);
  return entry;
}

function clear() {
  return save(emptyHistory());
}

module.exports = {
  load,
  save,
  addSession,
  updateSession,
  clear,
  HISTORY_PATH,
};
