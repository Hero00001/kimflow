// test/paste-outcome.test.cjs
//
// Regression test for the HIGH defect: a failed paste was reported as a
// success.
//
// `pasteText` returned `{ ok: true }` synchronously while the actual paste
// ran in an `execFile` callback whose error was only `console.error`-ed. The
// recorder therefore always computed `pasteOk === true`, and the
// paste-failure toast ("Paste failed - text copied to clipboard, press
// Ctrl+V") could never fire.
//
// Where `powershell.exe`/`osascript`/`xdotool` is missing or blocked by
// policy, the user silently lost their dictation with no indication that
// anything had failed.
const test = require('node:test');
const assert = require('node:assert');
const { pasteText } = require('../backend/paste.cjs');

// This suite runs outside Electron, where the clipboard is unavailable, so
// the clipboard write is injected wherever a working one is expected.
const clipboard = { writeClipboard: () => {} };

test('a failing paste command is reported as a failure', async () => {
  const result = await pasteText('hello', {
    writeClipboard: clipboard.writeClipboard,
    run: () => Promise.reject(new Error('no powershell')),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /no powershell/);
});

test('a successful paste command reports success', async () => {
  const result = await pasteText('hello', {
    writeClipboard: clipboard.writeClipboard,
    run: () => Promise.resolve(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.error, null);
});

test('empty text is a no-op success', async () => {
  let ran = false;
  const result = await pasteText('', { run: () => { ran = true; return Promise.resolve(); } });
  assert.equal(result.ok, true);
  assert.equal(ran, false, 'no paste command is run for empty text');
});

test('the clipboard write failure is reported too', async () => {
  // A missing Electron clipboard (headless, or a locked-down environment)
  // must not be reported as a successful paste.
  const result = await pasteText('hello', {
    run: () => Promise.resolve(),
    writeClipboard: () => { throw new Error('clipboard unavailable'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /clipboard unavailable/);
});
