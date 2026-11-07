'use strict';
// test/ipc-boundary-b6.test.cjs
//
// Fail-first tests for B6 (IPC boundary hardening & key handling):
//   - #03/W2: navigation + window.open are denied on every window; a sender
//             whose URL is not a KimFlow page is untrusted even with a
//             matching webContents id.
//   - #04:    check-whisper-binary only accepts main-process-handed-out paths.
//   - #05:    the Gemini key travels in the x-goog-api-key HEADER, never the URL.
//   - F-13:   resolveModel does not cache a failure-derived default.
//   - F-07:   an explicit nova-3 for an unsupported language downgrades to nova-2.
//   - F-17:   deepgram testConnection times out.
//   - F-08:   concurrent ensureHelper() spawns exactly ONE helper.
//   - N7:     stale temp WAVs are swept at startup.
//   - N3:     CSP meta present on index.html and overlay.html.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

// ── #03 / W2: navigation + open guards, sender URL validation ───────────────

test('navigation is denied off-page and window.open is denied, on every window', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b6-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());

  for (const win of harness.instances) {
    const wc = win.webContents;
    const willNavigate = wc.listeners.get('will-navigate');
    assert.equal(typeof willNavigate, 'function', 'will-navigate guard is wired');

    let prevented = 0;
    const event = { preventDefault: () => { prevented += 1; } };
    willNavigate(event, 'https://evil.example/payload.html');
    assert.equal(prevented, 1, 'an off-site navigation is blocked');
    willNavigate(event, 'file:///C:/somewhere/dist/index.html');
    assert.equal(prevented, 1, 'our own pages still load');
    willNavigate(event, 'http://localhost:1420/src/overlay.html');
    assert.equal(prevented, 1, 'the dev server entry still loads');

    if (wc.openHandler) {
      const decision = wc.openHandler({ url: 'https://evil.example' });
      assert.deepEqual(decision, { action: 'deny' }, 'window.open is denied');
    }
  }
});

test('a sender whose URL is not a KimFlow page is untrusted (#03)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b6-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const main = harness.instances[0];

  const good = await harness.handlers.get('get-settings')({ sender: { id: main.webContents.id } });
  assert.ok(good && typeof good === 'object', 'a legitimate sender is trusted');

  const hijacked = { sender: { id: main.webContents.id, getURL: () => 'https://evil.example/pwned.html' } };
  // The async wrapper matters: the handler throws synchronously, and on this
  // Node build assert.rejects only matches against a genuine promise
  // rejection, not a synchronous throw.
  await assert.rejects(
    async () => harness.handlers.get('get-settings')(hijacked),
    /Unauthorized IPC sender/,
    'a matching webContents id with a foreign URL must be rejected',
  );
});

// ── #04: whisper binary existence oracle ────────────────────────────────────

test('check-whisper-binary rejects paths the main process never handed out (#04)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b6-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const main = harness.instances[0];
  const event = { sender: { id: main.webContents.id } };
  const check = harness.handlers.get('check-whisper-binary');

  // Even a path that REALLY exists is rejected: it was not main-provided.
  assert.equal(await check(event, path.join(os.tmpdir())), false, 'foreign paths are rejected outright');
  assert.equal(await check(event, process.execPath), false, 'even the electron binary path is rejected');
});

// ── #05 + F-13: Gemini key handling ─────────────────────────────────────────

function loadGeminiWithFakeAxios(t, impl) {
  const axiosResolved = require.resolve('axios');
  const prevAxios = require.cache[axiosResolved];
  require.cache[axiosResolved] = { id: axiosResolved, filename: axiosResolved, loaded: true, exports: impl };
  const modResolved = require.resolve('../backend/gemini.cjs');
  const prevMod = require.cache[modResolved];
  delete require.cache[modResolved];
  t.after(() => {
    delete require.cache[modResolved];
    if (prevMod) require.cache[modResolved] = prevMod;
    delete require.cache[axiosResolved];
    if (prevAxios) require.cache[axiosResolved] = prevAxios;
  });
  return require('../backend/gemini.cjs');
}

test('Gemini requests carry the key in the header, never the URL (#05)', async (t) => {
  const calls = [];
  const gemini = loadGeminiWithFakeAxios(t, {
    get: async (url, config) => { calls.push({ url, config }); return { status: 404, data: {} }; },
    post: async () => ({ status: 500, data: {} }),
  });
  await gemini.inspectModel('SECRET-KEY-123', 'gemini-3.6-flash');
  assert.equal(calls.length, 1);
  const { url, config } = calls[0];
  assert.equal(config.headers['x-goog-api-key'], 'SECRET-KEY-123', 'the key is in the auth header');
  assert.ok(!config.params || !config.params.key, 'no key in query params');
  assert.ok(!String(url).includes('SECRET-KEY-123'), 'the key never appears in the URL');
});

test('resolveModel does not cache a failure-derived default (F-13)', async (t) => {
  let calls = 0;
  const gemini = loadGeminiWithFakeAxios(t, {
    get: async () => { calls += 1; return { status: 503, data: {} }; },
    post: async () => ({ status: 500, data: {} }),
  });
  const first = await gemini.resolveModel('KEY');
  const second = await gemini.resolveModel('KEY');
  assert.equal(first, second, 'both fall back to the default model');
  assert.equal(calls, 2, 'a transient failure must NOT be cached — the second call retries');
});

// ── F-07 / F-17: Deepgram ───────────────────────────────────────────────────

test('an explicit nova-3 for an unsupported language downgrades to nova-2 (F-07)', () => {
  const { resolveDeepgramModel } = require('../backend/engines/deepgram.cjs');
  const ko = resolveDeepgramModel('ko', 'nova-3');
  assert.equal(ko.model, 'nova-2', 'korean is not a nova-3 single language');
  const zh = resolveDeepgramModel('zh', 'nova-3');
  assert.equal(zh.model, 'nova-2');
  const en = resolveDeepgramModel('en', 'nova-3');
  assert.equal(en.model, 'nova-3', 'supported languages keep nova-3');
  const auto = resolveDeepgramModel('auto', 'nova-3');
  assert.equal(auto.model, 'nova-3', 'auto keeps nova-3 multilingual mode');
});

test('deepgram testConnection times out instead of hanging forever (F-17)', async (t) => {
  const sdkResolved = require.resolve('@deepgram/sdk');
  const prevSdk = require.cache[sdkResolved];
  require.cache[sdkResolved] = {
    id: sdkResolved, filename: sdkResolved, loaded: true,
    exports: { createClient: () => ({ manage: { getProjects: () => new Promise(() => {}) } }) },
  };
  const modResolved = require.resolve('../backend/engines/deepgram.cjs');
  const prevMod = require.cache[modResolved];
  delete require.cache[modResolved];
  t.after(() => {
    delete require.cache[modResolved];
    if (prevMod) require.cache[modResolved] = prevMod;
    delete require.cache[sdkResolved];
    if (prevSdk) require.cache[sdkResolved] = prevSdk;
  });
  const { testConnection } = require('../backend/engines/deepgram.cjs');
  await assert.rejects(
    // The outer race keeps the SUITE fast if the timeout is missing: before
    // the fix the inner promise never settles and this fails with a clear
    // message instead of hanging the whole run.
    Promise.race([
      testConnection('key', 80),
      new Promise((_, reject) => setTimeout(() => reject(new Error('no timeout enforced')), 1500)),
    ]),
    /Timed out/,
  );
});

// ── F-08: single-flight helper startup ──────────────────────────────────────

test('concurrent ensureHelper calls spawn exactly one helper (F-08)', (t) => {
  const { EventEmitter } = require('node:events');
  let spawns = 0;
  const makeStream = () => {
    const stream = new EventEmitter();
    stream.resume = () => stream;
    stream.pause = () => stream;
    stream.read = () => null;
    return stream;
  };
  const fakeChild = () => {
    spawns += 1;
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdin.write = (data, cb) => { if (cb) cb(); return true; };
    child.stdin.end = () => {};
    child.stderr = makeStream();
    child.stdout = makeStream();
    setImmediate(() => child.stdout.emit('data', Buffer.from('READY\n')));
    return child;
  };
  const { ensureHelper, shutdownPasteHelper } = require('../backend/paste-helper.cjs');
  t.after(() => shutdownPasteHelper());
  const a = ensureHelper({ spawn: fakeChild, startupTimeoutMs: 2000 });
  const b = ensureHelper({ spawn: fakeChild, startupTimeoutMs: 2000 });
  assert.equal(spawns, 1, 'two concurrent starts must share ONE spawn');
  return Promise.all([a, b]).then(([sa, sb]) => {
    assert.equal(sa, sb, 'both callers get the same live helper');
    shutdownPasteHelper();
  });
});

// ── N7: stale temp WAV sweep ────────────────────────────────────────────────

test('stale temp recordings are swept at startup (N7)', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b6-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} });
  const configDir = path.join(home, '.kimflow');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'temp_recording_orphan.wav'), Buffer.from('RIFF'));
  await loadMain({ locale: 'en-US', home });
  assert.equal(
    fs.existsSync(path.join(configDir, 'temp_recording_orphan.wav')),
    false,
    'the orphaned WAV from a crashed session is removed at startup',
  );
});

// ── N3: CSP on the main-window and overlay entries ──────────────────────────

test('index.html and overlay.html declare a CSP (N3)', () => {
  for (const file of ['index.html', path.join('src', 'overlay.html')]) {
    const html = fs.readFileSync(path.resolve(file), 'utf8');
    assert.match(html, /http-equiv="Content-Security-Policy"/, `${file} must declare a CSP`);
    assert.match(html, /script-src 'self'/, `${file} scripts must be locked to 'self'`);
  }
});
