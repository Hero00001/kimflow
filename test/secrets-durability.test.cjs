// test/secrets-durability.test.cjs
//
// A present-but-undecryptable secret_<name>.bin must NOT look like "no key".
// Regression test for keys "disappearing" after an update while the .bin
// files are still on disk in ~/.kimflow.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

// Isolated backend: fake HOME (fresh CONFIG_DIR) + fake Electron safeStorage.
// Restores everything via t.after so the real ~/.kimflow is never touched.
function useIsolatedSecrets(t) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-secrets-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const electronResolved = require.resolve('electron');
  const prevElectronEntry = require.cache[electronResolved];
  require.cache[electronResolved] = {
    id: electronResolved,
    filename: electronResolved,
    loaded: true,
    exports: { safeStorage: fakeSafeStorage() },
  };
  const backendPaths = ['../backend/settings.cjs', '../backend/secrets.cjs'].map((m) => require.resolve(m));
  const savedEntries = new Map();
  for (const resolved of backendPaths) {
    if (require.cache[resolved]) {
      savedEntries.set(resolved, require.cache[resolved]);
      delete require.cache[resolved];
    }
  }
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    for (const resolved of backendPaths) delete require.cache[resolved];
    for (const [resolved, entry] of savedEntries) require.cache[resolved] = entry;
    if (prevElectronEntry) require.cache[electronResolved] = prevElectronEntry;
    else delete require.cache[electronResolved];
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  const settings = require('../backend/settings.cjs');
  const secrets = require('../backend/secrets.cjs');
  return { settings, secrets, configDir: settings.CONFIG_DIR };
}

test('valid encrypted secret reads back as saved', (t) => {
  const { secrets } = useIsolatedSecrets(t);
  secrets.setSecret('deepgramApiKey', 'dg-valid');
  assert.equal(secrets.getSecret('deepgramApiKey'), 'dg-valid');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'saved');
});

test('missing secret file reads as missing, not unreadable', (t) => {
  const { secrets } = useIsolatedSecrets(t);
  assert.equal(secrets.getSecret('deepgramApiKey'), '');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'missing');
});

test('present-but-garbage secret file reads as unreadable, not missing', (t) => {
  const { settings, secrets } = useIsolatedSecrets(t);
  fs.mkdirSync(settings.CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(settings.CONFIG_DIR, 'secret_deepgramApiKey.bin'), Buffer.from([0x00, 0xff, 0x13, 0x37]));
  // Compat: value readers still see '' (falsy) so engine fallbacks keep working.
  assert.equal(secrets.getSecret('deepgramApiKey'), '');
  // ...but status must distinguish "unreadable" from "no key saved".
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'unreadable');
});

test('successful save leaves no temp file behind', (t) => {
  const { settings, secrets } = useIsolatedSecrets(t);
  secrets.setSecret('speechmaticsApiKey', 'sm-valid');
  assert.equal(secrets.getSecret('speechmaticsApiKey'), 'sm-valid');
  const leftovers = fs.readdirSync(settings.CONFIG_DIR).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});
