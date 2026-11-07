'use strict';
// test/config-durability-b1.test.cjs
//
// Fail-first tests for B1 (config & secret durability). Each test below MUST
// fail against the pre-B1 code and pass after it:
//   - A1 / F-11 : a locked or corrupt config must not be silently replaced by
//                 defaults, and a corrupt config falls back to its .bak.
//   - F-04      : save() must never destroy the existing config.json when the
//                 atomic rename fails (previous code did rmSync before rename).
//   - F-03      : a deleted secret must stay deleted across the copy-only
//                 migration (no resurrection from a legacy blob).
//   - F-12      : hostile, oversized inputs are rejected without a multi-million
//                 part split, and vocabulary terms are length-capped.
//   - A1 (int)  : get-settings must not overwrite a real config on read failure.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { useIsolatedConfig } = require('./helpers/isolated-config.cjs');
const { loadMain } = require('./helpers/electron-main-harness.cjs');
const { isValidHotkey } = require('../backend/hotkeys.cjs');
const { normalizeVocabulary } = require('../backend/vocabulary.cjs');

function stubReadError(t) {
  const original = fs.readFileSync;
  const restore = () => { fs.readFileSync = original; };
  fs.readFileSync = (p, ...rest) => {
    if (String(p).includes('config.json')) {
      const err = new Error('EACCES: permission denied');
      err.code = 'EACCES';
      throw err;
    }
    return original(p, ...rest);
  };
  t.after(restore);
  return restore;
}

test('load() reports a read-error status when the config cannot be read', (t) => {
  const { settings, configDir } = useIsolatedConfig(t);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ engine: 'deepgram', hotkey: 'F2', uiLanguage: 'en' }));
  stubReadError(t);
  const result = settings.load();
  assert.equal(settings.getLoadStatus(), 'read-error', 'status must expose the failed read');
  assert.equal(result.engine, 'local', 'defaults are returned for the renderer');
});

test('load() falls back to .bak when config.json is corrupt', (t) => {
  const { settings, configDir } = useIsolatedConfig(t);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), '{ this is not valid json');
  fs.writeFileSync(path.join(configDir, 'config.json.bak'), JSON.stringify({ engine: 'deepgram', hotkey: 'F2', uiLanguage: 'en' }));
  const result = settings.load();
  assert.equal(result.engine, 'deepgram', 'the last-good backup must be used');
  assert.equal(settings.getLoadStatus(), 'recovered');
  // No write happened: the corrupt config.json is still corrupt, not clobbered.
  assert.match(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'), /not valid/);
});

test('save() does not destroy the existing config when the rename fails', (t) => {
  const { settings, configDir } = useIsolatedConfig(t);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ engine: 'deepgram', hotkey: 'F2' }));
  const original = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error('EPERM: operation not permitted');
    err.code = 'EPERM';
    throw err;
  };
  t.after(() => { fs.renameSync = original; });
  assert.throws(() => settings.save({ engine: 'local', hotkey: 'F2' }));
  const after = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  assert.equal(after.engine, 'deepgram', 'original config must survive a failed save');
});

test('save() writes a .bak of the previous config before overwriting', (t) => {
  const { settings, configDir } = useIsolatedConfig(t);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ engine: 'deepgram', hotkey: 'F2' }));
  settings.save({ engine: 'local', hotkey: 'F2' });
  const bak = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json.bak'), 'utf8'));
  assert.equal(bak.engine, 'deepgram', '.bak must hold the pre-save config');
  const cur = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  assert.equal(cur.engine, 'local', 'config is updated to the new value');
});

test('a deleted secret stays deleted across migration (no resurrection)', (t) => {
  const { secrets, configDir, secretsDir } = useIsolatedConfig(t);
  secrets.setSecretsDir(secretsDir);
  fs.mkdirSync(configDir, { recursive: true });
  // A legacy blob still sitting in the old location.
  fs.writeFileSync(path.join(configDir, 'secret_geminiApiKey.bin'), 'LEGACY-BLOB');
  secrets.setSecret('geminiApiKey', 'current');
  secrets.deleteSecret('geminiApiKey');
  // The copy-only migration must NOT bring the legacy blob back.
  secrets.migrateSecrets(configDir, secretsDir);
  assert.equal(
    fs.existsSync(path.join(secretsDir, 'secret_geminiApiKey.bin')),
    false,
    'a deleted key must not resurrect from the legacy location',
  );
});

test('isValidHotkey rejects an enormous hotkey without splitting it', () => {
  const huge = 'A+'.repeat(1_000_000);
  const start = Date.now();
  const ok = isValidHotkey(huge);
  assert.equal(ok, false);
  assert.ok(Date.now() - start < 1000, 'must reject without splitting millions of parts');
});

test('normalizeVocabulary caps per-term length', () => {
  const out = normalizeVocabulary(['normal term', 'x'.repeat(5000), 'another']);
  assert.deepEqual(out, ['normal term', 'another']);
});

test('get-settings does not overwrite a real config on read failure', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-a1-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const configDir = path.join(home, '.kimflow');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ engine: 'deepgram', hotkey: 'F2', uiLanguage: 'en' }),
  );

  const harness = await loadMain({ locale: 'en-US', home });
  const event = { sender: { id: harness.instances[0].webContents.id } };

  const restoreRead = stubReadError(t);
  try {
    const result = await harness.handlers.get('get-settings')(event);
    assert.equal(result.engine, 'local', 'renderer gets defaults on read failure');
  } finally {
    restoreRead();
  }
  const after = JSON.parse(fs.readFileSync(path.join(configDir, 'config.json'), 'utf8'));
  assert.equal(after.engine, 'deepgram', 'real config must not be overwritten with defaults');
  assert.equal(after.uiLanguage, 'en');
  harness.restore();
});
