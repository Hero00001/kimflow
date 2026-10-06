// test/settings-save.test.cjs
//
// save() must survive a broken legacy ~/.typr (e.g. unreadable dir or a file
// squatting at that path): current settings save regardless, like load()
// already tolerates.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function useIsolatedSettings(t) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-settings-'));
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

test('save succeeds when the legacy dir is unreadable', (t) => {
  const { settings, fakeHome } = useIsolatedSettings(t);
  fs.writeFileSync(path.join(fakeHome, '.typr'), 'squatter, not a directory');
  const saved = settings.save({ engine: 'deepgram', deepgramModel: 'nova-3' });
  assert.equal(saved.engine, 'deepgram');
  const onDisk = JSON.parse(fs.readFileSync(path.join(fakeHome, '.kimflow', 'config.json'), 'utf8'));
  assert.equal(onDisk.engine, 'deepgram');
});
