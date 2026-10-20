// test/secrets-fallback.test.cjs
//
// Regression tests for two MEDIUM defects in the secret store:
//
// 1. `setSecret` never threw — it caught everything and fell back to an
//    in-memory copy — so `migratePlaintextKeys`'s try/catch was dead code and
//    the failure to persist was SILENT. The key was kept in memory for the
//    session, but the user was told "Key saved on this device ✓" and lost
//    the key on the next restart.
//
// 2. `setSecret`'s EPERM/EEXIST fallback unlinked the existing blob BEFORE
//    renaming the replacement into place, so a failure between the two
//    destroyed the only copy of the key.
//
// The "no plaintext on disk" invariant is deliberate and stays: a key that
// cannot be encrypted is not persisted in the clear. What changes is that the
// user is told, instead of being shown a false "saved" status.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Load backend/secrets.cjs with a fake Electron safeStorage and an isolated
 * HOME, so the real ~/.kimflow is never touched.
 *
 * @param {object|null} safeStorage the fake safeStorage, or null for "the
 *   platform has no secret store".
 */
function loadSecrets(t, safeStorage) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-sec-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const electronResolved = require.resolve('electron');
  const prevElectron = require.cache[electronResolved];
  // settings.cjs computes CONFIG_DIR from the home directory at import
  // time, so it must be evicted alongside secrets.cjs for the isolated home
  // to take effect.
  const settingsResolved = require.resolve('../backend/settings.cjs');
  const prevSettings = require.cache[settingsResolved];
  const secretsResolved = require.resolve('../backend/secrets.cjs');
  const prevSecrets = require.cache[secretsResolved];
  require.cache[electronResolved] = {
    id: electronResolved, filename: electronResolved, loaded: true,
    exports: safeStorage ? { safeStorage } : {},
  };
  delete require.cache[settingsResolved];
  delete require.cache[secretsResolved];
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevElectron) require.cache[electronResolved] = prevElectron;
    else delete require.cache[electronResolved];
    if (prevSettings) require.cache[settingsResolved] = prevSettings;
    else delete require.cache[settingsResolved];
    if (prevSecrets) require.cache[secretsResolved] = prevSecrets;
    else delete require.cache[secretsResolved];
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  const secrets = require('../backend/secrets.cjs');
  return { secrets, configDir: require('../backend/settings.cjs').CONFIG_DIR };
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`ENC:${String(value)}`, 'utf8'),
    decryptString: (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (!text.startsWith('ENC:')) throw new Error('Failed to decrypt: invalid payload');
      return text.slice(4);
    },
  };
}

test('a key that could not be persisted is not reported as saved', (t) => {
  // No secret store: the platform cannot encrypt. The key lives in memory
  // for this session only, and the status must say so rather than claim the
  // key is safely stored.
  const { secrets } = loadSecrets(t, null);
  secrets.setSecret('deepgramApiKey', 'key-abc');
  assert.equal(secrets.getSecret('deepgramApiKey'), 'key-abc', 'the key still works this session');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'volatile');
});

test('a key that persisted is reported as saved', (t) => {
  const { secrets } = loadSecrets(t, fakeSafeStorage());
  secrets.setSecret('deepgramApiKey', 'key-abc');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'saved');
});

test('setSecret reports whether the value reached durable storage', (t) => {
  const withStore = loadSecrets(t, fakeSafeStorage());
  assert.equal(withStore.secrets.setSecret('deepgramApiKey', 'key-abc'), true);

  const withoutStore = loadSecrets(t, null);
  assert.equal(withoutStore.secrets.setSecret('deepgramApiKey', 'key-abc'), false);
});

test('the plaintext is never left in the settings object', (t) => {
  // The "no plaintext on disk" invariant holds even when the key could not
  // be encrypted: it is kept in memory, never written in the clear.
  const { secrets } = loadSecrets(t, null);
  const out = secrets.migratePlaintextKeys({ deepgramApiKey: 'key-abc' });
  assert.equal(out.settings.deepgramApiKey, '', 'no plaintext may remain in the settings');
});

test('a failed rename leaves the previous secret intact', (t) => {
  const { secrets, configDir } = loadSecrets(t, fakeSafeStorage());
  secrets.setSecret('deepgramApiKey', 'good-key');
  const secretFile = path.join(configDir, 'secret_deepgramApiKey.bin');
  assert.ok(fs.existsSync(secretFile));

  // Simulate a locked destination: the tmp -> blob replace fails, but the
  // moves that restore the previous blob still work.
  const realRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    if (String(from).endsWith('.tmp') && String(to).endsWith('.bin')) {
      const error = new Error('EPERM: operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return realRename.call(fs, from, to);
  };
  try {
    secrets.setSecret('deepgramApiKey', 'new-key');
  } finally {
    fs.renameSync = realRename;
  }

  // The previous blob must still be on disk — the failed write destroys
  // nothing.
  const onDisk = fs.readFileSync(secretFile, 'utf8');
  assert.equal(onDisk, 'ENC:good-key', 'the previous secret must survive on disk');
  // The value in use is the one the user just entered, and it is reported
  // as held in memory rather than saved.
  assert.equal(secrets.getSecret('deepgramApiKey'), 'new-key');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'volatile');
});
