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
      try { setSecret(name, next[name]); } catch {}
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

// Tri-state read: 'saved' (decrypts fine), 'missing' (no file, no memory
// key), or 'unreadable' (a file exists but yields no value — corrupt blob or
// decryption failure). Lets the UI tell those last two apart.
function describeSecret(name) {
  if (getSecret(name) !== '') return 'saved';
  try {
    if (fs.existsSync(secretPath(name))) return 'unreadable';
  } catch {
    // An unreadable directory listing degrades to "missing".
  }
  return 'missing';
}
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
        fs.rmSync(dest, { force: true });
        fs.renameSync(tmp, dest);
      }
      loggedReadFailures.delete(name);
      return;
    }
  } catch (error) {
    console.error(`[KimFlow] Unable to persist secret "${name}" to disk; keeping it for this session only:`, error instanceof Error ? error.message : error);
  }
  memoryFallback[name] = String(value);
}
function hasSecret(name) {
  return describeSecret(name) === 'saved';
}
function deleteSecret(name) {
  delete memoryFallback[name];
  loggedReadFailures.delete(name);
  try {
    fs.rmSync(secretPath(name), { force: true });
  } catch {}
}
module.exports = { getSecret, setSecret, hasSecret, deleteSecret, describeSecret, migratePlaintextKeys, SECRET_NAMES };
