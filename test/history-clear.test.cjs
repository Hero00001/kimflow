// test/history-clear.test.cjs
//
// Regression test for the MEDIUM defect: "Clear history" did not clear.
//
// `clear()` called `save(emptyHistory())`, and `save()` copies the current
// file to `history.json.bak` BEFORE overwriting it — so the "cleared"
// transcripts stayed on disk in the backup, and `load()` falls back to that
// backup whenever the main file is unreadable. Cleared history could reappear.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Load backend/history.cjs against an isolated HOME. */
function useIsolatedHistory(t) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-history-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  // settings.cjs computes CONFIG_DIR at import time, so it must be evicted
  // too for the isolated home to take effect.
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

test('clear removes the transcripts from disk, including the backup', (t) => {
  const { history, dir } = useIsolatedHistory(t);
  history.save({ sessions: [entry('a', 'my secret dictation')] });
  assert.ok(fs.existsSync(path.join(dir, 'history.json')));

  history.clear();

  assert.deepEqual(history.load().sessions, [], 'the history is empty');
  assert.equal(fs.existsSync(path.join(dir, 'history.json.bak')), false, 'no backup of the cleared history');
  const onDisk = fs.readFileSync(path.join(dir, 'history.json'), 'utf8');
  assert.ok(!onDisk.includes('my secret dictation'), 'the transcript must not remain on disk');
});

test('a cleared history does not come back when the main file is unreadable', (t) => {
  const { history, dir } = useIsolatedHistory(t);
  history.save({ sessions: [entry('a', 'my secret dictation')] });
  history.clear();

  // The main file is truncated, e.g. by a crash or a sync conflict.
  fs.writeFileSync(path.join(dir, 'history.json'), '{truncated...');

  assert.deepEqual(history.load().sessions, [], 'the cleared history must not reappear');
});

test('clear on an empty history is harmless', (t) => {
  const { history } = useIsolatedHistory(t);
  assert.deepEqual(history.clear().sessions, []);
  assert.deepEqual(history.load().sessions, []);
});
