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
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    if (parsed && Array.isArray(parsed.sessions)) return parsed;
  } catch {
    // Fall back to an empty history when the file is missing or malformed.
  }
  return emptyHistory();
}

function save(history) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
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

function addSession({ text, durationMs, createdAt }) {
  const history = load();
  history.sessions.unshift({
    id: crypto.randomUUID(),
    text: text || '',
    title: titleFromText(text),
    createdAt: createdAt || Date.now(),
    durationMs: durationMs || 0,
  });
  if (history.sessions.length > MAX_ENTRIES) {
    history.sessions = history.sessions.slice(0, MAX_ENTRIES);
  }
  return save(history);
}

function clear() {
  return save(emptyHistory());
}

module.exports = {
  load,
  save,
  addSession,
  clear,
  HISTORY_PATH,
};
