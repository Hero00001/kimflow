// test/history-durability.test.cjs
//
// history.json must survive a corrupt write: save() keeps the previous good
// generation aside, and load() falls back to it before giving up to empty.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function useIsolatedHistory(t) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-history-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const evict = ['../backend/settings.cjs', '../backend/secrets.cjs', '../backend/history.cjs']
    .map((m) => require.resolve(m));
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
  const history = require('../backend/history.cjs');
  const settings = require('../backend/settings.cjs');
  return { history, dir: settings.CONFIG_DIR };
}

function entry(id, text) {
  return { id, text, title: text, createdAt: 1, durationMs: 0 };
}

test('save keeps the previous good generation as backup', (t) => {
  const { history, dir } = useIsolatedHistory(t);
  history.save({ sessions: [entry('a', 'first')] });
  history.save({ sessions: [entry('b', 'second')] });
  const backup = JSON.parse(fs.readFileSync(path.join(dir, 'history.json.bak'), 'utf8'));
  assert.equal(backup.sessions[0].id, 'a');
  assert.equal(history.load().sessions[0].id, 'b');
});

test('load falls back to backup when the main file is corrupt', (t) => {
  const { history, dir } = useIsolatedHistory(t);
  history.save({ sessions: [entry('good', 'kept')] });
  history.save({ sessions: [entry('newer', 'latest')] });
  fs.writeFileSync(path.join(dir, 'history.json'), '{truncated...');
  const loaded = history.load();
  assert.equal(loaded.sessions[0].id, 'good');
});

test('load returns empty only when both copies are corrupt', (t) => {
  const { history, dir } = useIsolatedHistory(t);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'history.json'), '{truncated...');
  fs.writeFileSync(path.join(dir, 'history.json.bak'), '[broken...');
  assert.deepEqual(history.load(), { sessions: [] });
});
