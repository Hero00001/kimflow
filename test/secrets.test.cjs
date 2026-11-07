// test/secrets.test.cjs
//
// These tests deliberately write config.json and secret blobs, so they run
// against a throwaway home. The old version backed up and rewrote the REAL
// `~/.kimflow/config.json`, which could corrupt a user's settings if the
// process died between the write and the finally block.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { useIsolatedConfig } = require('./helpers/isolated-config.cjs');

test('migrates plaintext keys out of settings object', (t) => {
  const { secrets } = useIsolatedConfig(t);
  const out = secrets.migratePlaintextKeys({ deepgramApiKey: 'key-abc', geminiApiKey: 'AIza-x', engine: 'local' });
  assert.equal(out.settings.deepgramApiKey, '');
  assert.equal(out.settings.geminiApiKey, '');
  assert.equal(out.migrated, true);
});

test('load migrates legacy plaintext keys: call-site resolves via keychain, stripped JSON persists', (t) => {
  const { settings, secrets, configDir, home } = useIsolatedConfig(t);
  assert.equal(configDir, path.join(home, '.kimflow'),
    'the test must write only the throwaway config directory');

  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const deepgramKey = `dg-roundtrip-${suffix}`;
  const geminiKey = `gm-roundtrip-${suffix}`;
  const speechmaticsKey = `sm-roundtrip-${suffix}`;
  const configPath = path.join(configDir, 'config.json');

  fs.mkdirSync(configDir, { recursive: true });
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
  assert.equal(loaded.deepgramApiKey || secrets.getSecret('deepgramApiKey'), deepgramKey);
  assert.equal(loaded.speechmaticsApiKey || secrets.getSecret('speechmaticsApiKey'), speechmaticsKey);
  assert.equal(loaded.geminiApiKey || secrets.getSecret('geminiApiKey'), geminiKey);
  // B2: the stripped file is written back — no plaintext lingers on disk.
  const onDisk = fs.readFileSync(configPath, 'utf8');
  assert.ok(!onDisk.includes(deepgramKey), 'deepgram key must not linger on disk');
  assert.ok(!onDisk.includes(speechmaticsKey), 'speechmatics key must not linger on disk');
  assert.ok(!onDisk.includes(geminiKey), 'gemini key must not linger on disk');
  // save() round-trip keeps the keychain intact while persisting stripped JSON.
  const saved = settings.save({ ...loaded, deepgramApiKey: deepgramKey });
  assert.equal(saved.deepgramApiKey, '');
  assert.equal(saved.deepgramApiKey || secrets.getSecret('deepgramApiKey'), deepgramKey);
  const onDiskAfterSave = fs.readFileSync(configPath, 'utf8');
  assert.ok(!onDiskAfterSave.includes(deepgramKey), 'saved JSON must stay stripped');
});
