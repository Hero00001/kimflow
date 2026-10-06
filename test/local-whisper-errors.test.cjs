const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('whisper missing-binary message is friendly single-line', async () => {
  const lw = require('../backend/engines/local-whisper.cjs');
  try { await lw.transcribe('small', 'nope.wav', 'auto', '/definitely/missing/whisper-cli', null, 'thorough', []); assert.fail('should throw'); }
  catch (e) { assert.ok(!/stderr|exit code/i.test(e.message), e.message); assert.ok(/not found|Select Binary/i.test(e.message), e.message); }
});

test('whisper exec-failure surfaces friendly single-line with raw in details', async () => {
  // Isolate CONFIG_DIR via a fake HOME so the real ~/.kimflow is untouched.
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-fakehome-'));
  const fakeConfigDir = path.join(fakeHome, '.kimflow');
  fs.mkdirSync(fakeConfigDir, { recursive: true });
  // Fake model file satisfies the model-exists gate; the binary below fails.
  fs.writeFileSync(path.join(fakeConfigDir, 'ggml-small.bin'), 'fake-model');

  const prevUserProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;
  const backendModules = [
    '../backend/settings.cjs',
    '../backend/model-download.cjs',
    '../backend/engines/local-whisper.cjs',
  ];
  const resolved = backendModules.map((m) => { try { return require.resolve(m); } catch { return null; } });
  const cached = new Map();
  for (const r of resolved) {
    if (r && require.cache[r]) { cached.set(r, require.cache[r]); delete require.cache[r]; }
  }
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  try {
    const lw = require('../backend/engines/local-whisper.cjs');
    // process.execPath (node.exe) exists and is executable but rejects
    // whisper args, exiting non-zero — a portable fake-binary stand-in.
    try {
      await lw.transcribe('small', 'nope.wav', 'auto', process.execPath, undefined, 'thorough', []);
      assert.fail('should throw');
    } catch (e) {
      assert.ok(!/stderr:|exit code:/i.test(e.message), `raw leaked into message: ${e.message}`);
      assert.ok(!/\n/.test(e.message), `message must be single-line: ${e.message}`);
      assert.equal(e.message, 'Transcription failed — see details and try again.');
      assert.ok(typeof e.details === 'string' && e.details.length > 0, 'expected .details with raw output');
      assert.ok(/whisper\.cpp failed/i.test(e.details), `details missing raw header: ${e.details.slice(0, 200)}`);
      assert.ok(/exit code:/i.test(e.details), `details missing exit code: ${e.details.slice(0, 200)}`);
      assert.ok(e.code != null, `expected .code preserved, got ${e.code}`);
    }
  } finally {
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    for (const r of resolved) {
      if (r) delete require.cache[r];
    }
    for (const [r, mod] of cached) require.cache[r] = mod;
    try { fs.rmSync(fakeHome, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
});

test('recorder empty-hint throws friendly hint and abort paths stay silent', async () => {
  const fs2 = require('node:fs');
  const src = fs2.readFileSync(require('node:path').join(__dirname, '..', 'backend', 'recorder.cjs'), 'utf8');
  // Empty transcript must throw the friendly hint (not return { empty:true }).
  assert.ok(/No speech detected — check mic level and try again\./.test(src), 'empty-hint message missing');
  assert.ok(/empty transcript \(engine=/.test(src), 'empty-hint .details missing');
  // Both abort/drop paths must return the silent-abort shape.
  const abortShapes = src.match(/return \{ text: '', aborted: true \}/g) || [];
  assert.ok(abortShapes.length >= 2, `expected >=2 aborted:true returns, found ${abortShapes.length}`);
  // Pure helper still behaves (mirrors cancel.test.cjs without duplicating it).
  const { shouldDropResult } = require('../backend/recorder.cjs');
  assert.equal(shouldDropResult(1, 2), true);
  assert.equal(shouldDropResult(2, 2), false);
});

test('illegal-instruction crash is recognized with a CPU hint', () => {
  const { isCrashExitCode, crashErrorMessage } = require('../backend/engines/local-whisper.cjs');
  assert.equal(isCrashExitCode(3221225501), true);
  assert.equal(isCrashExitCode(-1073741795), true);
  assert.ok(/Illegal instruction|newer CPU/i.test(crashErrorMessage(3221225501, '')), 'expected CPU hint');
});


test('older crash hints fire for unsigned and signed codes', () => {
  const { crashErrorMessage } = require('../backend/engines/local-whisper.cjs');
  assert.ok(/required DLL was not found/i.test(crashErrorMessage(3221225781, '')), 'unsigned 0xC0000135');
  assert.ok(/required DLL was not found/i.test(crashErrorMessage(-1073741515, '')), 'signed 0xC0000135');
});

