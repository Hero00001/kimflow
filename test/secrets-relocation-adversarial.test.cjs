// test/secrets-relocation-adversarial.test.cjs
//
// Adversarial cases for the secrets relocation (setSecretsDir + migrateSecrets)
// beyond the happy paths in secrets-dir.test.cjs:
//   - secrets "stranded" in the previous directory after a re-point
//   - migration must NEVER overwrite a destination blob (younger or older)
//   - migration copies a corrupt source blob verbatim (byte-identical)
//   - the last setSecretsDir call wins
//   - secretPath before any injection falls back to ~/.kimflow
//   - main.cjs startup ORDER: setSecretsDir + migrateSecrets run before any
//     settings load / IPC registration
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * Fresh backend/secrets.cjs + backend/settings.cjs with a fake Electron
 * safeStorage and an isolated HOME (same pattern as secrets-dir.test.cjs).
 */
function loadSecrets(t, safeStorage) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-secadv-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const electronResolved = require.resolve('electron');
  const prevElectron = require.cache[electronResolved];
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

// ── setSecretsDir after secrets already exist in the previous directory ─────

test('re-pointing after a write strands the old file: describeSecret reports missing, never crashes', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const dirA = path.join(fakeHome, 'app-data-a');
  const dirB = path.join(fakeHome, 'app-data-b');
  secrets.setSecretsDir(dirA);
  assert.equal(secrets.setSecret('deepgramApiKey', 'key-in-a'), true);
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'saved');

  // The app re-points (e.g. userData changed between launches): dir B has no
  // blob yet. The blob in A is stranded — the state must be an honest
  // 'missing' (or 'volatile'), never a crash, and never a false 'saved'.
  secrets.setSecretsDir(dirB);
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'missing');
  assert.equal(secrets.hasSecret('deepgramApiKey'), false);
  assert.equal(secrets.getSecret('deepgramApiKey'), '');
  // The old file was not destroyed by the re-point.
  assert.ok(fs.existsSync(path.join(dirA, 'secret_deepgramApiKey.bin')));
});

test('the last setSecretsDir call wins', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const dirA = path.join(fakeHome, 'a');
  const dirB = path.join(fakeHome, 'b');
  const dirC = path.join(fakeHome, 'c');
  secrets.setSecretsDir(dirA);
  secrets.setSecretsDir(dirB);
  assert.equal(secrets.secretPath('geminiApiKey'), path.join(dirB, 'secret_geminiApiKey.bin'));
  assert.equal(secrets.setSecret('geminiApiKey', 'key-b'), true);
  assert.ok(fs.existsSync(path.join(dirB, 'secret_geminiApiKey.bin')));
  secrets.setSecretsDir(dirC);
  assert.equal(secrets.secretPath('geminiApiKey'), path.join(dirC, 'secret_geminiApiKey.bin'));
  assert.equal(secrets.getSecret('geminiApiKey'), '', 'the blob written to B must not be served from C');
  assert.equal(secrets.describeSecret('geminiApiKey'), 'missing');
});

test('secretPath before any injection resolves against the legacy ~/.kimflow fallback', (t) => {
  const { secrets, configDir } = loadSecrets(t, fakeSafeStorage());
  // The "race": a module calls secretPath (or getSecret/describeSecret)
  // before main.cjs ever injected a directory.
  assert.equal(secrets.secretPath('speechmaticsApiKey'), path.join(configDir, 'secret_speechmaticsApiKey.bin'));
  assert.equal(secrets.describeSecret('speechmaticsApiKey'), 'missing');
  assert.equal(secrets.getSecret('speechmaticsApiKey'), '');
  assert.equal(secrets.secretsBaseDir(), configDir);
});

// ── migrateSecrets: never overwrite, copy corrupt blobs verbatim ────────────

test('migration never overwrites a destination blob, even when the source is YOUNGER', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const oldDir = path.join(fakeHome, 'legacy');
  const newDir = path.join(fakeHome, 'app-data');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });
  // Destination written LATER than the source (the common real-world case:
  // the user re-saved the key in the new version after a first migration).
  fs.writeFileSync(path.join(oldDir, 'secret_deepgramApiKey.bin'), 'blob-OLD-content');
  fs.writeFileSync(path.join(newDir, 'secret_deepgramApiKey.bin'), 'blob-NEW-content');
  const oldStat = fs.statSync(path.join(oldDir, 'secret_deepgramApiKey.bin'));
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(oldDir, 'secret_deepgramApiKey.bin'), past, past);

  assert.equal(secrets.migrateSecrets(oldDir, newDir), 0);
  assert.equal(fs.readFileSync(path.join(newDir, 'secret_deepgramApiKey.bin'), 'utf8'), 'blob-NEW-content');
  assert.ok(fs.statSync(path.join(newDir, 'secret_deepgramApiKey.bin')).mtimeMs >= oldStat.mtimeMs - 1
    || fs.readFileSync(path.join(newDir, 'secret_deepgramApiKey.bin'), 'utf8') === 'blob-NEW-content');
});

test('migration never overwrites a destination blob, even when the source is OLDER', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const oldDir = path.join(fakeHome, 'legacy');
  const newDir = path.join(fakeHome, 'app-data');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'secret_geminiApiKey.bin'), 'blob-OLD');
  const source = path.join(newDir, 'secret_geminiApiKey.bin');
  fs.writeFileSync(source, 'blob-DEST');
  // Make the destination older than the source on the filesystem clock too.
  const past = new Date(Date.now() - 3_600_000);
  fs.utimesSync(source, past, past);

  assert.equal(secrets.migrateSecrets(oldDir, newDir), 0);
  assert.equal(fs.readFileSync(source, 'utf8'), 'blob-DEST');
});

test('a corrupt old blob is copied byte-verbatim (migration never interprets blob contents)', (t) => {
  const { secrets, fakeHome } = loadSecrets(t, fakeSafeStorage());
  const oldDir = path.join(fakeHome, 'legacy');
  const newDir = path.join(fakeHome, 'app-data');
  fs.mkdirSync(oldDir, { recursive: true });
  const garbage = Buffer.from([0x00, 0xd8, 0xff, 0xfe, 0x00, 'x'.charCodeAt(0), 0xff, 0x00]);
  fs.writeFileSync(path.join(oldDir, 'secret_speechmaticsApiKey.bin'), garbage);

  assert.equal(secrets.migrateSecrets(oldDir, newDir), 1);
  const copied = fs.readFileSync(path.join(newDir, 'secret_speechmaticsApiKey.bin'));
  assert.ok(copied.equals(garbage), 'the copied blob must be byte-identical to the corrupt source');
  // Reading it yields no key (fake safeStorage rejects the payload) and the
  // state degrades to 'unreadable', not a crash.
  assert.equal(secrets.getSecret('speechmaticsApiKey'), '');
});

// ── main.cjs startup ordering ────────────────────────────────────────────────

test('main.cjs relocates secrets BEFORE any settings load or IPC registration', async (t) => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-order-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  // Record every secret-module call in order. The harness resolves relative
  // requires and replaces them by basename, so BOTH main.cjs's destructured
  // import and settings.cjs's migratePlaintextKeys land on this recorder.
  const calls = [];
  const secretsStub = {
    getSecret: () => '',
    setSecret: () => false,
    hasSecret: () => false,
    deleteSecret: () => {},
    describeSecret: () => 'missing',
    SECRET_NAMES: ['deepgramApiKey', 'speechmaticsApiKey', 'geminiApiKey'],
    setSecretsDir: (dir) => { calls.push(['setSecretsDir', dir]); },
    migrateSecrets: (oldDir, newDir) => { calls.push(['migrateSecrets', oldDir, newDir]); return 0; },
    migratePlaintextKeys: (raw) => {
      calls.push(['migratePlaintextKeys']);
      return { settings: raw && typeof raw === 'object' ? raw : {}, migrated: false };
    },
  };

  const { loadMain } = require('./helpers/electron-main-harness.cjs');
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  const main = await loadMain({
    locale: 'en',
    home: fakeHome,
    overrides: { 'secrets.cjs': secretsStub },
  });
  try {
    const userDataDir = path.join(fakeHome, 'userData');
    const legacyDir = path.join(fakeHome, '.kimflow');

    assert.equal(calls[0][0], 'setSecretsDir', 'setSecretsDir must be the first secret call');
    assert.equal(calls[0][1], userDataDir);
    assert.equal(calls[1][0], 'migrateSecrets', 'migrateSecrets must follow immediately');
    assert.deepEqual(calls[1].slice(1), [legacyDir, userDataDir]);

    // Every settings load (which routes plaintext migration through the
    // secrets module) must come AFTER the relocation. If a settings read
    // landed first, secrets written during it would go to the wrong place.
    const loadIndexes = calls.map((c, i) => (c[0] === 'migratePlaintextKeys' ? i : -1)).filter((i) => i >= 0);
    assert.ok(loadIndexes.length > 0, 'main.cjs must load settings at startup');
    for (const index of loadIndexes) {
      assert.ok(index > 1, `settings load at call #${index} must follow the relocation`);
    }

    // IPC registration also happens after relocation: the get-settings
    // handler exists and serves normalized settings.
    assert.equal(typeof main.handlers.get('get-settings'), 'function');
    const settings = await main.handlers.get('get-settings')(
      { sender: { id: main.instances[0].webContents.id } },
    );
    assert.equal(settings.polishMode, 'light');
    assert.equal(settings.deepgramModel, 'auto');
  } finally {
    main.restore();
  }
});

// A static pin as a second line of defence: the relocation block must sit at
// the very top of the whenReady callback, ahead of registerIpc()/loadSettings.
test('main.cjs source orders the relocation ahead of registerIpc and loadSettings', () => {
  const source = fs.readFileSync(path.resolve('main.cjs'), 'utf8');
  const readyStart = source.indexOf('app.whenReady()');
  assert.ok(readyStart !== -1);
  const ready = source.slice(readyStart);
  const relocation = ready.indexOf('setSecretsDir(userDataDir)');
  const ipc = ready.indexOf('registerIpc();');
  const load = ready.indexOf('loadSettings()');
  assert.ok(relocation !== -1, 'whenReady must call setSecretsDir');
  assert.ok(ipc !== -1 && load !== -1);
  assert.ok(relocation < ipc, 'setSecretsDir must precede registerIpc() in whenReady');
  assert.ok(relocation < load, 'setSecretsDir must precede loadSettings() in whenReady');
});
