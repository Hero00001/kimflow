// test/widget-flag.test.cjs
//
// `useFlowBarWidget` is the rollback switch for the floating UI. Default must
// be ON (including for configs written before the key existed), only an
// explicit `false` rolls back, and KIMFLOW_FLOWBAR=0 forces the legacy overlay
// for a single launch.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

/**
 * Require backend/settings.cjs against an isolated home directory. settings.cjs
 * resolves the config path once at module load, so the env must be set first
 * and the module cache evicted.
 */
function useIsolatedSettings(t) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-flowbar-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const evict = ['../backend/settings.cjs', '../backend/secrets.cjs'].map((module) => require.resolve(module));
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

function writeConfig(fakeHome, value) {
  const dir = path.join(fakeHome, '.kimflow');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(value, null, 2), 'utf8');
}

test('the default is on', (t) => {
  const { settings } = useIsolatedSettings(t);
  assert.equal(settings.DEFAULT_SETTINGS.useFlowBarWidget, true);
  assert.equal(settings.normalizeSettings({}).useFlowBarWidget, true);
  assert.equal(settings.load().useFlowBarWidget, true);
});

test('normalizeSettings round-trips the flag', (t) => {
  const { settings } = useIsolatedSettings(t);
  assert.equal(settings.normalizeSettings({ useFlowBarWidget: true }).useFlowBarWidget, true);
  assert.equal(settings.normalizeSettings({ useFlowBarWidget: false }).useFlowBarWidget, false);
});

test('only an explicit false rolls back', (t) => {
  const { settings } = useIsolatedSettings(t);
  for (const value of ['false', 0, null, undefined, 1, 'yes', {}]) {
    assert.equal(settings.normalizeSettings({ useFlowBarWidget: value }).useFlowBarWidget, true, `value: ${String(value)}`);
  }
});

test('a config written before this release gets the widget', (t) => {
  const { settings, fakeHome } = useIsolatedSettings(t);
  writeConfig(fakeHome, { engine: 'deepgram', uiLanguage: 'en' });
  const loaded = settings.load();
  assert.equal(loaded.useFlowBarWidget, true);
  assert.equal(loaded.engine, 'deepgram');
});

test('an explicit false survives a save/load round-trip', (t) => {
  const { settings } = useIsolatedSettings(t);
  settings.save({ ...settings.DEFAULT_SETTINGS, useFlowBarWidget: false });
  assert.equal(settings.load().useFlowBarWidget, false);
  // ...and it is written to disk, not just kept in memory.
  const raw = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.kimflow', 'config.json'), 'utf8'));
  assert.equal(raw.useFlowBarWidget, false);
});

test('KIMFLOW_FLOWBAR=0 forces the legacy branch even with the flag on', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-flowbar-entry-'));
  const previousFlowBar = process.env.KIMFLOW_FLOWBAR;
  t.after(() => {
    if (previousFlowBar === undefined) delete process.env.KIMFLOW_FLOWBAR;
    else process.env.KIMFLOW_FLOWBAR = previousFlowBar;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  process.env.KIMFLOW_FLOWBAR = '0';
  const harness = await loadMain({ locale: 'en-US', home, settings: { useFlowBarWidget: true } });
  t.after(() => harness.restore());
  const floating = harness.instances[1];
  assert.ok(floating.loadedFile.endsWith('overlay.html'), `expected the legacy overlay, got ${floating.loadedFile}`);
});
