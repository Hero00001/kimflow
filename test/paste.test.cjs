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
