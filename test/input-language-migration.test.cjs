// test/input-language-migration.test.cjs
//
// A stored inputLanguage of 'en' comes from one of two sources:
//   - a legacy config that FORCED English (must be reset to Auto Detect
//     exactly once), or
//   - a deliberate English selection made after the migration (must be
//     preserved forever).
// The migration marker is what tells them apart.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function useIsolatedSettings(t) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-lang-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const evict = ['../backend/settings.cjs', '../backend/secrets.cjs'].map((m) => require.resolve(m));
  const saved = new Map();
  for (const resolved of evict) {
    if (require.cache[resolved]) {
      saved.set(resolved, require.cache[resolved]);
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
    for (const resolved of evict) delete require.cache[resolved];
    for (const [resolved, entry] of saved) require.cache[resolved] = entry;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  return { settings: require('../backend/settings.cjs'), fakeHome };
}

function writeConfig(fakeHome, config) {
  fs.mkdirSync(path.join(fakeHome, '.kimflow'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.kimflow', 'config.json'), JSON.stringify(config), 'utf8');
}

function readConfig(fakeHome) {
  return JSON.parse(fs.readFileSync(path.join(fakeHome, '.kimflow', 'config.json'), 'utf8'));
}

test('legacy forced English is reset to Auto Detect exactly once', (t) => {
  const { settings, fakeHome } = useIsolatedSettings(t);
  writeConfig(fakeHome, { inputLanguage: 'en' });
  const loaded = settings.load();
  assert.equal(loaded.inputLanguage, 'auto');
  const onDisk = readConfig(fakeHome);
  assert.equal(onDisk.inputLanguage, 'auto');
  assert.equal(onDisk.inputLanguageMigrated, true);
  // A second load must not flip anything: the reset already happened.
  assert.equal(settings.load().inputLanguage, 'auto');
});

test('deliberate English selection is preserved across loads', (t) => {
  const { settings, fakeHome } = useIsolatedSettings(t);
  writeConfig(fakeHome, { inputLanguage: 'en', inputLanguageMigrated: true });
  const loaded = settings.load();
  assert.equal(loaded.inputLanguage, 'en');
  assert.equal(readConfig(fakeHome).inputLanguage, 'en');
});

test('renderer saves round-trip the migration marker', (t) => {
  const { settings, fakeHome } = useIsolatedSettings(t);
  // Legacy reset already happened at startup; the user then picks
  // English explicitly and the renderer saves the full settings object.
  writeConfig(fakeHome, { inputLanguage: 'auto', inputLanguageMigrated: true });
  settings.load();
  const saved = settings.save({ inputLanguage: 'en', inputLanguageMigrated: true, engine: 'local' });
  assert.equal(saved.inputLanguage, 'en');
  assert.equal(readConfig(fakeHome).inputLanguage, 'en');
  // The next launch must keep the deliberate English selection.
  assert.equal(settings.load().inputLanguage, 'en');
});
