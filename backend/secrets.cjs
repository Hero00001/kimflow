// backend/secrets.cjs
const fs = require('fs');
const path = require('path');
const SECRET_NAMES = ['deepgramApiKey', 'speechmaticsApiKey', 'geminiApiKey'];
let memoryFallback = {};
// Keys whose read failure was already logged (log once per key per process
// so every settings save doesn't re-spam the console).
const loggedReadFailures = new Set();

function secretPath(name) {
  return path.join(require('./settings.cjs').CONFIG_DIR, `secret_${name}.bin`);
}
function migratePlaintextKeys(settings) {
  const next = { ...settings };
  let migrated = false;
  for (const name of SECRET_NAMES) {
    if (typeof next[name] === 'string' && next[name].length > 0) {
      // The plaintext is always removed from the settings, so it can never
      // reach the config file — and `migrated` stays true so the caller
      // rewrites the config without it.
      //
      // Whether it reached durable storage decides what the user is told
      // about it: a key that only made it into memory must not be reported
      // as saved, because it will be lost when the app restarts.
      setSecret(name, next[name]);
      next[name] = '';
      migrated = true;
    }
  }
  return { settings: next, migrated };
}
function getSecret(name) {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const raw = fs.readFileSync(secretPath(name));
      return safeStorage.decryptString(raw);
    }
  } catch (error) {
    // A missing file is normal (no key saved yet) — stay silent. Anything
    // else (corrupt blob, DPAPI failure) is logged once per key instead of
    // vanishing into an empty string nobody can diagnose.
    const message = error instanceof Error ? error.message : String(error);
    const missing = (error && error.code === 'ENOENT') || /ENOENT/i.test(message);
    if (!missing && !loggedReadFailures.has(name)) {
      loggedReadFailures.add(name);
      console.error(`[KimFlow] Unable to read saved secret "${name}":`, message);
    }
  }
  return memoryFallback[name] || '';
}

// Tri-state read: 'saved' (persisted securely), 'volatile' (held in memory
// only — it will be lost when the app restarts), 'missing' (no key saved), or
// 'unreadable' (a file exists but yields no value — corrupt blob or
// decryption failure). Lets the UI tell those last two apart.
function describeSecret(name) {
  let persisted = false;
  try {
    persisted = fs.existsSync(secretPath(name));
  } catch {
    // An unreadable directory listing degrades to "not persisted".
  }
  if (getSecret(name) !== '') return persisted ? 'saved' : 'volatile';
  if (persisted) return 'unreadable';
  return 'missing';
}
/**
 * Store a secret durably.
 *
 * @returns {boolean} true when the value reached durable storage, false when
 *   it only reached the in-memory fallback.
 */
function setSecret(name, value) {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(String(value));
      fs.mkdirSync(require('./settings.cjs').CONFIG_DIR, { recursive: true });
      // Atomic write (tmp + rename): a crash mid-save must never leave a
      // truncated blob that decrypts to nothing on the next launch.
      const dest = secretPath(name);
      const tmp = `${dest}.tmp`;
      fs.writeFileSync(tmp, enc);
      try {
        fs.renameSync(tmp, dest);
      } catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error;
        // The destination is locked (AV scanner, OneDrive, a file indexer).
        // Move the old blob aside rather than deleting it: if the rename
        // below fails, the previous secret is still recoverable.
        const backup = `${dest}.previous`;
        try { fs.rmSync(backup, { force: true }); } catch { /* best-effort */ }
        fs.renameSync(dest, backup);
        try {
          fs.renameSync(tmp, dest);
        } catch (renameError) {
          // Put the previous secret back before reporting the failure.
          try { fs.renameSync(backup, dest); } catch { /* best-effort */ }
          throw renameError;
        }
        try { fs.rmSync(backup, { force: true }); } catch { /* best-effort */ }
      }
      loggedReadFailures.delete(name);
      return true;
    }
  } catch (error) {
    console.error(`[KimFlow] Unable to persist secret "${name}" to disk; keeping it for this session only:`, error instanceof Error ? error.message : error);
  }
  memoryFallback[name] = String(value);
  return false;
}
function hasSecret(name) {
  // A key held only in memory is still usable for this session, so it
  // counts as present. `describeSecret` is what distinguishes the two.
  const state = describeSecret(name);
  return state === 'saved' || state === 'volatile';
}
function deleteSecret(name) {
  delete memoryFallback[name];
  loggedReadFailures.delete(name);
  try {
    fs.rmSync(secretPath(name), { force: true });
  } catch {}
}
module.exports = { getSecret, setSecret, hasSecret, deleteSecret, describeSecret, migratePlaintextKeys, SECRET_NAMES };
