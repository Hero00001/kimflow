// test/secrets.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { migratePlaintextKeys, getSecret } = require('../backend/secrets.cjs');
test('migrates plaintext keys out of settings object', () => {
  const out = migratePlaintextKeys({ deepgramApiKey: 'key-abc', geminiApiKey: 'AIza-x', engine: 'local' });
  assert.equal(out.settings.deepgramApiKey, '');
  assert.equal(out.settings.geminiApiKey, '');
  assert.equal(out.migrated, true);
});

test('load migrates legacy plaintext keys: call-site resolves via keychain, stripped JSON persists', () => {
  const settings = require('../backend/settings.cjs');
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const deepgramKey = `dg-roundtrip-${suffix}`;
  const geminiKey = `gm-roundtrip-${suffix}`;
  const speechmaticsKey = `sm-roundtrip-${suffix}`;
  const configPath = settings.CONFIG_DIR + require('node:path').sep + 'config.json';
  const hadExisting = fs.existsSync(configPath);
  const backup = hadExisting ? fs.readFileSync(configPath) : null;
  try {
    fs.mkdirSync(settings.CONFIG_DIR, { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ engine: 'deepgram', deepgramApiKey: deepgramKey, speechmaticsApiKey: speechmaticsKey, geminiApiKey: geminiKey }, null, 2),
      'utf8',
    );
    const loaded = settings.load();
    // Shape stays stable: key fields are empty strings in the returned object.
    assert.equal(loaded.deepgramApiKey, '');
    assert.equal(loaded.speechmaticsApiKey, '');
    assert.equal(loaded.geminiApiKey, '');
    // Engine call-site pattern resolves via the keychain.
    assert.equal(loaded.deepgramApiKey || getSecret('deepgramApiKey'), deepgramKey);
    assert.equal(loaded.speechmaticsApiKey || getSecret('speechmaticsApiKey'), speechmaticsKey);
    assert.equal(loaded.geminiApiKey || getSecret('geminiApiKey'), geminiKey);
    // B2: the stripped file is written back — no plaintext lingers on disk.
    const onDisk = fs.readFileSync(configPath, 'utf8');
    assert.ok(!onDisk.includes(deepgramKey), 'deepgram key must not linger on disk');
    assert.ok(!onDisk.includes(speechmaticsKey), 'speechmatics key must not linger on disk');
    assert.ok(!onDisk.includes(geminiKey), 'gemini key must not linger on disk');
    // save() round-trip keeps the keychain intact while persisting stripped JSON.
    const saved = settings.save({ ...loaded, deepgramApiKey: deepgramKey });
    assert.equal(saved.deepgramApiKey, '');
    assert.equal(saved.deepgramApiKey || getSecret('deepgramApiKey'), deepgramKey);
    const onDiskAfterSave = fs.readFileSync(configPath, 'utf8');
    assert.ok(!onDiskAfterSave.includes(deepgramKey), 'saved JSON must stay stripped');
  } finally {
    if (hadExisting) fs.writeFileSync(configPath, backup);
    else if (fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
  }
});
