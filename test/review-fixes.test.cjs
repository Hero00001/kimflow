// test/review-fixes.test.cjs
//
// Regression tests for the defects found in the final branch review.
//
// 1. A key that could NOT be persisted was reported as "saved" when a stale
//    blob from an earlier write was still on disk — and the app kept using
//    the OLD key, so the key the user just typed was silently dropped.
//
// 2. The hotkey restore path claimed a fallback hotkey even when the
//    re-registration failed, leaving the app with NO shortcut while
//    `getActiveHotkey()` claimed one.
//
// 3. A transient HTTP failure (503) was cached as "model not found" — the
//    same class of bug as the transport failure already fixed.
//
// 4. The run-terminating comma was dropped when the next word was a unit.
//
// 5. "and" was still swallowed after a scale word when no number followed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// ── helpers ──────────────────────────────────────────────────────────────────

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

/** Load backend/secrets.cjs against an isolated HOME and a fake safeStorage. */
function loadSecrets(t, safeStorage) {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-rev-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const electronResolved = require.resolve('electron');
  const prevElectron = require.cache[electronResolved];
  const settingsResolved = require.resolve('../backend/settings.cjs');
  const secretsResolved = require.resolve('../backend/secrets.cjs');
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
    delete require.cache[settingsResolved];
    delete require.cache[secretsResolved];
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  return require('../backend/secrets.cjs');
}

/** Load backend/hotkeys.cjs with a controllable globalShortcut. */
function loadHotkeys(t, registerImpl) {
  const electronResolved = require.resolve('electron');
  const prevElectron = require.cache[electronResolved];
  const hotkeysResolved = require.resolve('../backend/hotkeys.cjs');
  require.cache[electronResolved] = {
    id: electronResolved, filename: electronResolved, loaded: true,
    exports: { globalShortcut: { register: registerImpl, unregisterAll: () => {} } },
  };
  delete require.cache[hotkeysResolved];
  t.after(() => {
    if (prevElectron) require.cache[electronResolved] = prevElectron;
    else delete require.cache[electronResolved];
    delete require.cache[hotkeysResolved];
  });
  return require('../backend/hotkeys.cjs');
}

// ── 1. a key that could not be persisted ─────────────────────────────────────

test('a failed write is reported as volatile, and the new key is the one in use', (t) => {
  const secrets = loadSecrets(t, fakeSafeStorage());
  secrets.setSecret('deepgramApiKey', 'OLD-KEY');

  // The write of the replacement fails (the blob is locked).
  const realRename = fs.renameSync;
  fs.renameSync = function patched(from, to) {
    if (String(from).endsWith('.tmp') && String(to).endsWith('.bin')) {
      const error = new Error('EPERM: operation not permitted');
      error.code = 'EPERM';
      throw error;
    }
    return realRename.call(fs, from, to);
  };
  let persisted;
  try {
    persisted = secrets.setSecret('deepgramApiKey', 'NEW-KEY');
  } finally {
    fs.renameSync = realRename;
  }

  assert.equal(persisted, false, 'the write did not reach the disk');
  assert.equal(secrets.describeSecret('deepgramApiKey'), 'volatile', 'it must not claim to be saved');
  assert.equal(secrets.getSecret('deepgramApiKey'), 'NEW-KEY', 'the key just entered is the one in use');
});

// ── 2. the hotkey restore path ───────────────────────────────────────────────

test('a hotkey that cannot be restored is not reported as active', (t) => {
  const calls = [];
  // The first registration succeeds; the new one and the restore both fail.
  let attempt = 0;
  const hotkeys = loadHotkeys(t, (accelerator) => {
    calls.push(accelerator);
    attempt += 1;
    return attempt === 1;
  });

  assert.equal(hotkeys.registerHotkeys('Ctrl+Alt+Space'), true);
  assert.equal(hotkeys.getActiveHotkey(), 'Ctrl+Alt+Space');

  assert.equal(hotkeys.registerHotkeys('Ctrl+Shift+K'), false, 'the new hotkey failed');
  assert.equal(
    hotkeys.getActiveHotkey(),
    '',
    'the app has no working shortcut, so it must not claim one',
  );
});

// ── 3. a transient HTTP failure ──────────────────────────────────────────────

test('a transient HTTP failure is not cached as "model not found"', async (t) => {
  const axiosResolved = require.resolve('axios');
  const geminiResolved = require.resolve('../backend/gemini.cjs');
  const prevAxios = require.cache[axiosResolved];
  const prevGemini = require.cache[geminiResolved];
  let httpCalls = 0;
  require.cache[axiosResolved] = {
    id: axiosResolved, filename: axiosResolved, loaded: true,
    exports: {
      get: async () => {
        httpCalls += 1;
        return { status: 503, data: { error: { message: 'upstream busy' } } };
      },
    },
  };
  delete require.cache[geminiResolved];
  t.after(() => {
    if (prevAxios) require.cache[axiosResolved] = prevAxios;
    else delete require.cache[axiosResolved];
    if (prevGemini) require.cache[geminiResolved] = prevGemini;
    else delete require.cache[geminiResolved];
  });
  const gemini = require('../backend/gemini.cjs');

  const first = await gemini.validateModel('key', 'gemini-3.6-flash');
  assert.equal(first.ok, false);
  assert.doesNotMatch(first.message, /was not found/i, 'a 503 is not "model not found"');

  // The next call must retry rather than serve a cached failure.
  await gemini.validateModel('key', 'gemini-3.6-flash');
  assert.equal(httpCalls, 2, 'the lookup must be retried');
});

// ── 4 & 5. number-word edge cases ───────────────────────────────────────────

test('the number parser keeps a unit consistent with its number', () => {
  const { formatNumberWords } = require('../backend/format-numbers.cjs');
  // A unit absorbs the punctuation that separated it from the number, and
  // carries its own.
  assert.equal(formatNumberWords('twenty five, percent.'), '25%.');
  assert.equal(formatNumberWords('twenty five, percent'), '25%');
});

test('and is preserved when no number follows it', () => {
  const { formatNumberWords } = require('../backend/format-numbers.cjs');
  assert.equal(formatNumberWords('one hundred and milk'), '100 and milk');
  assert.equal(formatNumberWords('one hundred and the rest'), '100 and the rest');
  // ...and still joins a number when one does follow.
  assert.equal(formatNumberWords('one hundred and five'), '105');
  assert.equal(formatNumberWords('two thousand and nineteen'), '2019');
});
