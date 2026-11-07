// test/harness-integrity.test.cjs
//
// The electron-main-harness substitutes backend modules with inert stubs. If a
// stub is missing a member that main.cjs calls, the affected IPC channel dies
// with a TypeError instead of reaching an assertion — and a test that never
// touches that channel still passes. Worse, main.cjs:605-613 catches a failed
// secret relocation at startup, so an incomplete secrets.cjs stub silently
// selects the legacy ~/.kimflow path without any test noticing.
//
// These three tests pin the harness contract itself. They MUST fail against
// the pre-B0 harness.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-harness-integrity-'));
  t.after(() => {
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  return home;
}

// Plausible arguments for each handler. Channels omitted here take no argument.
// The point is to reach the handler body, not to assert its result: a stub that
// is missing a member throws a TypeError before any real logic can run.
const ARGS = {
  'save-settings': [{}],
  'validate-gemini-model': ['gemini-2.0-flash'],
  'write-clipboard': ['hello'],
  'window-control': ['minimize'],
  'check-model-downloaded': ['base'],
  'download-model': ['base'],
  'download-engine': ['cpu'],
  'activate-engine': ['cpu'],
  'stop-recording': [new Uint8Array([1, 2, 3])],
  'check-whisper-binary': ['C:/no-such-whisper-cli.exe'],
  'test-deepgram-connection': ['key'],
  'test-speechmatics-connection': ['key'],
  'has-secret': ['geminiApiKey'],
  'secret-state': ['geminiApiKey'],
  'delete-secret': ['geminiApiKey'],
  'overlay-action': ['stop'],
};

function isStubFailure(error) {
  if (error instanceof TypeError) return true;
  const message = String((error && error.message) || error);
  return /is not a function|Cannot read properties of undefined|Cannot destructure|is not defined/.test(message);
}

test('every registered IPC handler is callable without a stub TypeError', async (t) => {
  const harness = await loadMain({ locale: 'en-US', home: tempHome(t) });
  t.after(() => harness.restore());
  const event = { sender: { id: harness.instances[0].webContents.id } };

  // Guard against a vacuously-passing loop. 30 handlers minus the two dead
  // channels removed in B10 ('toggle-recording', 'list-microphones') = 28;
  // test/ipc-contract-b10.test.cjs pins the exact set.
  assert.ok(harness.handlers.size >= 28, `expected the full IPC surface, got ${harness.handlers.size} handlers`);

  const failures = [];
  for (const [channel, handler] of harness.handlers) {
    const args = ARGS[channel] || [];
    try {
      await handler(event, ...args);
    } catch (error) {
      if (isStubFailure(error)) failures.push(`${channel}: ${error.message}`);
    }
  }
  for (const [channel, handler] of harness.listeners) {
    try {
      await handler(event, 0.5);
    } catch (error) {
      if (isStubFailure(error)) failures.push(`${channel} (ipcMain.on): ${error.message}`);
    }
  }
  assert.deepEqual(failures, [], 'no handler may fail because a harness stub is incomplete');
});

test('startup never falls back to the legacy secrets location', async (t) => {
  const home = tempHome(t);
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.map((value) => String((value && value.message) || value)).join(' '));
  let harness;
  try {
    harness = await loadMain({ locale: 'en-US', home });
  } finally {
    console.error = originalError;
  }
  t.after(() => harness.restore());

  assert.deepEqual(
    logged.filter((line) => /relocation failed/i.test(line)),
    [],
    'the relocation catch must never fire: an incomplete stub silently selects ~/.kimflow',
  );
});

test('overrides cannot replace a deliberately-unstubbed module', async (t) => {
  await assert.rejects(
    () => loadMain({
      locale: 'en-US',
      home: tempHome(t),
      overrides: { 'settings.cjs': { loadSettings: () => ({}) } },
    }),
    /settings\.cjs/,
    'settings.cjs is the module under test and must not be stubbable',
  );
});
