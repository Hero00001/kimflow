// test/paste.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { pasteText, runWindowsPaste } = require('../backend/paste.cjs');

test('pasteText returns a result object', async () => {
  // The clipboard and the paste command are injected: this suite runs
  // outside Electron, where neither is available.
  const r = await pasteText('hello', {
    writeClipboard: () => {},
    run: () => Promise.resolve(),
  });
  assert.equal(typeof r.ok, 'boolean');
});

// --- Windows fallback ladder -------------------------------------------------
//
// runWindowsPaste is exported so the ladder can be exercised on any platform
// without spawning a real PowerShell. Rung 1 is the persistent SendInput
// helper; rung 2 is the legacy per-paste SendKeys injection; only when BOTH
// fail does the error reach the caller (and with it the recorder's
// "paste failed, text copied to clipboard" fallback toast).

test('the ladder uses the helper and never touches SendKeys when it succeeds', async () => {
  let sendKeysCalls = 0;
  await runWindowsPaste({
    pasteViaHelper: () => Promise.resolve(),
    runSendKeys: () => { sendKeysCalls += 1; return Promise.resolve(); },
  });
  assert.equal(sendKeysCalls, 0);
});

test('the ladder falls back to SendKeys when the helper fails', async () => {
  let sendKeysCalls = 0;
  await runWindowsPaste({
    pasteViaHelper: () => Promise.reject(new Error('Add-Type blocked by policy')),
    runSendKeys: () => { sendKeysCalls += 1; return Promise.resolve(); },
  });
  assert.equal(sendKeysCalls, 1, 'the legacy SendKeys rung was used');
});

test('the ladder falls back again when the helper is respawned and fails once more', async () => {
  let sendKeysCalls = 0;
  let helperCalls = 0;
  await runWindowsPaste({
    pasteViaHelper: () => {
      helperCalls += 1;
      return Promise.reject(new Error(`helper attempt ${helperCalls} failed`));
    },
    runSendKeys: () => { sendKeysCalls += 1; return Promise.resolve(); },
  });
  assert.equal(helperCalls, 1, 'one helper attempt per paste');
  assert.equal(sendKeysCalls, 1, 'the paste still happened');
});

test('the ladder reports failure only when BOTH rungs fail', async () => {
  await assert.rejects(
    () => runWindowsPaste({
      pasteViaHelper: () => Promise.reject(new Error('helper dead')),
      runSendKeys: () => Promise.reject(new Error('powershell blocked')),
    }),
    /powershell blocked/,
    'the SendKeys error is the one the caller sees',
  );
});

test('a paste that only fails on the SendKeys rung reports the failure', async () => {
  const result = await pasteText('hello', {
    writeClipboard: () => {},
    run: () => Promise.reject(new Error('powershell blocked')),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /powershell blocked/);
});

// --- QA adversarial round (Edward) -------------------------------------------

test('QA: the ladder falls back to SendKeys when the helper times out', async () => {
  let sendKeysCalls = 0;
  await runWindowsPaste({
    pasteViaHelper: () => Promise.reject(new Error('paste helper timed out after 5000ms')),
    runSendKeys: () => { sendKeysCalls += 1; return Promise.resolve(); },
  });
  assert.equal(sendKeysCalls, 1, 'a wedged helper must still paste via SendKeys');
});

test('QA: the ladder falls back to SendKeys when the helper spawn throws synchronously', async () => {
  let sendKeysCalls = 0;
  await runWindowsPaste({
    pasteViaHelper: () => { throw new Error('spawn powershell.exe ENOENT'); },
    runSendKeys: () => { sendKeysCalls += 1; return Promise.resolve(); },
  });
  assert.equal(sendKeysCalls, 1, 'a synchronous spawn failure must not skip the fallback');
});

test('QA: when BOTH rungs fail the caller receives { ok: false, error }', async () => {
  const result = await pasteText('hello', {
    writeClipboard: () => {},
    run: () => runWindowsPaste({
      pasteViaHelper: () => Promise.reject(new Error('helper dead')),
      runSendKeys: () => Promise.reject(new Error('powershell blocked')),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /powershell blocked/,
    'the LAST rung error is what the recorder turns into the fallback toast');
});

test('QA: the clipboard is written BEFORE any paste mechanism is attempted, even on failure', async () => {
  const order = [];
  const result = await pasteText('hello', {
    writeClipboard: () => order.push('clipboard'),
    run: () => { order.push('mechanism'); return Promise.reject(new Error('powershell blocked')); },
  });
  assert.deepEqual(order, ['clipboard', 'mechanism'],
    'the recorder fallback toast depends on the text being on the clipboard');
  assert.equal(result.ok, false);
});

test('QA: empty text short-circuits before the clipboard and any mechanism', async () => {
  let calls = 0;
  const result = await pasteText('', {
    writeClipboard: () => { calls += 1; },
    run: () => { calls += 10; return Promise.resolve(); },
  });
  assert.deepEqual(result, { ok: true, error: null });
  assert.equal(calls, 0, 'nothing runs for empty text');
});

test('QA: a clipboard write failure aborts before any paste mechanism runs', async () => {
  let runCalls = 0;
  const result = await pasteText('hello', {
    writeClipboard: () => { throw new Error('clipboard locked'); },
    run: () => { runCalls += 1; return Promise.resolve(); },
  });
  assert.equal(runCalls, 0, 'no keystroke may be injected without the text on the clipboard');
  assert.equal(result.ok, false);
  assert.match(result.error, /clipboard locked/);
});

test('QA: integration — a helper PASTE_FAIL reason reaches the ladder boundary, then the caller', async () => {
  // The full chain with the REAL helper module driven by a fake child: the
  // PASTE_FAIL reason must not be swallowed between helper and ladder.
  const pasteHelper = require('../backend/paste-helper.cjs');
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.stdinLines = [];
  child.kill = () => {
    if (child.exitCode === null) {
      child.exitCode = 1;
      setImmediate(() => child.emit('exit', 1, null));
    }
    return true;
  };
  setImmediate(() => child.stdout.write('READY\n'));
  child.stdin.on('data', () => child.stdout.write('PASTE_FAIL SendInput injected 0 of 4 events\n'));
  const spawnImpl = () => child;

  let clipboardWritten = false;
  let helperReason = null;
  const result = await pasteText('hello', {
    writeClipboard: () => { clipboardWritten = true; },
    run: () => runWindowsPaste({
      pasteViaHelper: () => pasteHelper.pasteViaHelper({ spawn: spawnImpl }).catch((error) => {
        helperReason = error.message;
        throw error;
      }),
      runSendKeys: () => Promise.reject(new Error('powershell blocked')),
    }),
  });

  assert.equal(clipboardWritten, true, 'clipboard written even though every rung failed');
  assert.match(helperReason, /injected 0 of 4 events/,
    'the PASTE_FAIL reason propagated out of the helper into the ladder');
  assert.equal(result.ok, false);
  assert.match(result.error, /powershell blocked/,
    'the caller sees the final rung error and can show the fallback toast');
  pasteHelper.shutdownPasteHelper();
});
