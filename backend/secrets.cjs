// backend/secrets.cjs
const SECRET_NAMES = ['deepgramApiKey', 'speechmaticsApiKey', 'geminiApiKey'];
let memoryFallback = {};
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
      const raw = require('fs').readFileSync(require('path').join(require('./settings.cjs').CONFIG_DIR, `secret_${name}.bin`));
      return safeStorage.decryptString(raw);
    }
  } catch {}
  return memoryFallback[name] || '';
}
function setSecret(name, value) {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(String(value));
      require('fs').mkdirSync(require('./settings.cjs').CONFIG_DIR, { recursive: true });
      require('fs').writeFileSync(require('path').join(require('./settings.cjs').CONFIG_DIR, `secret_${name}.bin`), enc);
      return;
    }
  } catch {}
  memoryFallback[name] = String(value);
}
module.exports = { getSecret, setSecret, migratePlaintextKeys, SECRET_NAMES };
