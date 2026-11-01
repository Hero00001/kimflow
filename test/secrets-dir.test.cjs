// test/secrets-dir.test.cjs
//
// Secret blobs must be co-locatable with the Chromium os_crypt key (which
// lives in the app's `Local State` inside userData). These tests cover the
// injection seam (`setSecretsDir`), path resolution (`secretPath`), and the
// one-time old→new blob migration (`migrateSecrets`), all against temp
// directories — never a real userData location.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Load a FRESH backend/secrets.cjs instance with a fake Electron safeStorage
 * and an isolated HOME, so the real ~/.kimflow is never touched and module
 * state (the injected directory) never leaks between tests.
 *
 * @param {object} safeStorage fake safeStorage (see secrets-fallback.test.cjs)
 */
function loadSecrets(t, safeStorage) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-secdir-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const electronResolved = require.resolve('electron');
  const prevElectron = require.cache[electronResolved];
  // settings.cjs computes CONFIG_DIR from the home directory at import time,
  // so it must be evicted alongside secrets.cjs for the isolated home to take
  // effect. secrets.cjs requires settings.cjs lazily (inside functions), so
  // both must start from a clean cache.
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
  return { secrets, configDir: require('../backend/settings.cjs').CONFIG_DIR, fakeHome };
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

test('without injection, secrets resolve under the legacy ~/.kimflow config dir', (t) => {
  const { secrets, configDir } = loadSecrets(t, fakeSafeStorage());
  assert.equal(secrets.secretPath('deepgramApiKey'), path.join(configDir, 'secret_deepgramApiKey.bin'));
});

test('setSecretsDir redirects secret paths and secret writes to the injected directory', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const target = path.join(fakeHome, 'app-data');
  secrets.setSecretsDir(target);
  assert.equal(secrets.secretPath('deepgramApiKey'), path.join(target, 'secret_deepgramApiKey.bin'));
  // A write goes to the injected directory, not ~/.kimflow.
  assert.equal(secrets.setSecret('deepgramApiKey', 'key-abc'), true);
  assert.ok(fs.existsSync(path.join(target, 'secret_deepgramApiKey.bin')));
  assert.equal(secrets.getSecret('deepgramApiKey'), 'key-abc');
});

test('setSecretsDir rejects garbage directories', (t) => {
  const { secrets } = loadSecrets(t, fakeSafeStorage());
  for (const bad of ['', '   ', 'relative/dir', null, undefined, 42]) {
    assert.throws(() => secrets.setSecretsDir(bad), `expected rejection for ${JSON.stringify(bad)}`);
  }
  // A valid call afterwards still works: the rejected calls changed nothing.
  assert.doesNotThrow(() => secrets.setSecretsDir(os.tmpdir()));
});

test('migrateSecrets copies old blobs to the new directory and keeps the old files', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const oldDir = path.join(fakeHome, 'legacy');
  const newDir = path.join(fakeHome, 'app-data');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'secret_deepgramApiKey.bin'), 'blob-old');
  fs.writeFileSync(path.join(oldDir, 'secret_geminiApiKey.bin'), 'blob-old-gemini');

  const copied = secrets.migrateSecrets(oldDir, newDir);
  assert.equal(copied, 2);
  // New files exist with the same content...
  assert.equal(fs.readFileSync(path.join(newDir, 'secret_deepgramApiKey.bin'), 'utf8'), 'blob-old');
  assert.equal(fs.readFileSync(path.join(newDir, 'secret_geminiApiKey.bin'), 'utf8'), 'blob-old-gemini');
  // ...and the old files are NOT deleted (rollback safety).
  assert.equal(fs.readFileSync(path.join(oldDir, 'secret_deepgramApiKey.bin'), 'utf8'), 'blob-old');
  assert.equal(fs.readFileSync(path.join(oldDir, 'secret_geminiApiKey.bin'), 'utf8'), 'blob-old-gemini');
});

test('migrateSecrets never overwrites an existing destination blob and is idempotent', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const oldDir = path.join(fakeHome, 'legacy');
  const newDir = path.join(fakeHome, 'app-data');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'secret_deepgramApiKey.bin'), 'blob-old');
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(newDir, 'secret_deepgramApiKey.bin'), 'blob-new');

  assert.equal(secrets.migrateSecrets(oldDir, newDir), 0);
  assert.equal(fs.readFileSync(path.join(newDir, 'secret_deepgramApiKey.bin'), 'utf8'), 'blob-new');

  // A second run after a successful migration copies nothing.
  fs.rmSync(path.join(newDir, 'secret_deepgramApiKey.bin'));
  assert.equal(secrets.migrateSecrets(oldDir, newDir), 1);
  assert.equal(secrets.migrateSecrets(oldDir, newDir), 0);
});

test('migrateSecrets with no legacy blobs is a no-op', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  assert.equal(secrets.migrateSecrets(path.join(fakeHome, 'missing'), path.join(fakeHome, 'app-data')), 0);
});

test('migrateSecrets rejects garbage directories', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const ok = path.join(fakeHome, 'app-data');
  assert.throws(() => secrets.migrateSecrets('', ok));
  assert.throws(() => secrets.migrateSecrets(ok, 'relative'));
  assert.throws(() => secrets.migrateSecrets(null, ok));
});
