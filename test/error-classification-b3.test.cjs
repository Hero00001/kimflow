'use strict';
// test/error-classification-b3.test.cjs
//
// Fail-first tests for B3 (error reporting & classification). Each MUST fail
// against pre-B3 code:
//   - A4/F-15: real failures containing "abort" were silently swallowed.
//   - C1:      short diagnostics were discarded from the detail tooltip.
//   - A5:      EACCES/ENOSPC on the temp WAV rendered as "Microphone blocked".
//   - #21:     "403 permission denied" rendered as "Microphone blocked".
//   - A10:     an AI-polish failure was completely silent.
//   - (new)    console output is mirrored into a log file the user can open.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { isAbortError } = require('../backend/recorder-decisions.cjs');
const { friendlyMessageFor } = require('../backend/friendly-errors.cjs');
const { loadTs } = require('./helpers/ts-loader.cjs');
const { useIsolatedConfig } = require('./helpers/isolated-config.cjs');

const cache = new Map();
const i18n = loadTs('src/i18n/index.ts', undefined, cache);
const utils = loadTs('src/utils.ts', undefined, cache);
const EN = loadTs('src/i18n/locales/en.ts').en;
const AR = loadTs('src/i18n/locales/ar.ts').ar;

function wire(error, channel = 'stop-recording') {
  return new Error(`Error invoking remote method '${channel}': ${error.toString()}`);
}

function inLanguage(language, fn) {
  const previous = i18n.getLanguage();
  i18n.setLanguage(language);
  try { return fn(); } finally { i18n.setLanguage(previous); }
}

// ── A4 / F-15: abort classification is name/signal-based only ───────────────

test('real provider failures containing "abort" are NOT cancellations', () => {
  assert.equal(isAbortError(new Error('Deepgram request aborted by peer (HTTP 502)'), { aborted: false }), false);
  assert.equal(isAbortError(new Error('AbortController timeout in SDK connect'), null), false);
  assert.equal(isAbortError(new Error('upstream aborted the connection'), { aborted: false }), false);
});

test('genuine aborts are still recognised', () => {
  const abort = new Error('Transcription aborted');
  abort.name = 'AbortError';
  assert.equal(isAbortError(abort, null), true);
  const canceled = new Error('canceled');
  canceled.name = 'CanceledError';
  assert.equal(isAbortError(canceled, null), true);
  assert.equal(isAbortError(new Error('whatever'), { aborted: true }), true);
});

// ── C1: short diagnostics reach the tooltip ─────────────────────────────────

test('errorDetails keeps short diagnostics', () => {
  assert.equal(utils.errorDetails(new Error('Invalid API key — check Settings and try again.')),
    'Invalid API key — check Settings and try again.');
  assert.equal(
    utils.errorDetails(wire(new Error('No speech detected'))),
    'No speech detected',
    'the IPC wrapper is still stripped',
  );
});

// ── A5 / #21: classification order ──────────────────────────────────────────

test('a WAV-write EACCES is a storage error, not a microphone problem', () => {
  const message = 'EACCES: permission denied, open C:\\Users\\x\\.kimflow\\temp_recording_1.wav';
  assert.equal(friendlyMessageFor(Object.assign(new Error(message), { code: 'EACCES' })), EN['error.storage']);
  const rejection = wire(new Error(message));
  assert.equal(inLanguage('en', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), EN['error.storage']);
  assert.equal(inLanguage('ar', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), AR['error.storage']);
});

test('ENOSPC is a storage error in the backend table too', () => {
  assert.equal(
    friendlyMessageFor(new Error('Insufficient disk space (0 bytes free)')),
    EN['error.storage'],
  );
});

test('403 permission denied maps to invalidApiKey, not micBlocked', () => {
  assert.equal(friendlyMessageFor(new Error('403 permission denied')), EN['error.invalidApiKey']);
  const rejection = wire(new Error('403 permission denied'));
  assert.equal(inLanguage('en', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), EN['error.invalidApiKey']);
});

test('whisper EACCES keeps its specific guidance', () => {
  assert.equal(
    friendlyMessageFor(Object.assign(new Error('spawn whisper-cli failed'), { code: 'EACCES' })),
    EN['error.whisperNotExecutable'],
  );
});

test('real abort-worded failures are visible, canonical abort stays silent', () => {
  const rejection = wire(new Error('Deepgram request aborted by peer (HTTP 502)'));
  const rendered = inLanguage('en', () => utils.friendlyError(rejection, 'error.transcriptionFailed'));
  assert.notEqual(rendered, '', 'a real failure must not be silenced');
  assert.equal(rendered, EN['error.transcriptionFailed']);

  const canonical = new Error('Transcription aborted');
  canonical.name = 'AbortError';
  assert.equal(utils.friendlyError(wire(canonical), 'error.transcriptionFailed'), '');
  assert.equal(utils.friendlyError({ aborted: true }, 'error.transcriptionFailed'), '');
});

// ── A10: AI-polish failure surfaces as a warning ────────────────────────────

const TICK = () => new Promise((resolve) => setImmediate(resolve));

function loadRecorderWithFailingPolish(t) {
  const { settings: settingsMod } = useIsolatedConfig(t);
  void settingsMod;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-b3-'));
  const prevProfile = process.env.USERPROFILE;
  const prevHome = process.env.HOME;

  class FakeAudioRecorder {
    async start() {} async stop() {} async saveWav() {}
  }
  const fakes = {
    '../backend/audio.cjs': { AudioRecorder: FakeAudioRecorder },
    '../backend/paste.cjs': { pasteText: async () => ({ ok: true }) },
    '../backend/transcribe.cjs': {
      transcribeLocal: async () => ({ text: 'Hello world.', detectedLanguage: 'en' }),
      transcribeDeepgram: async () => ({ text: 'Hello world.', detectedLanguage: 'en' }),
      transcribeSpeechmatics: async () => ({ text: '', detectedLanguage: null }),
    },
    '../backend/translation.service.cjs': {
      warmup: async () => {},
      polish: async () => { throw new Error('Gemini quota exceeded'); },
      translate: async () => null,
    },
    '../backend/history.cjs': {
      addSession: () => ({ id: 'h1' }),
      updateSession: () => {},
      removeSession: () => true,
      load: () => ({ sessions: [] }),
      clear: () => ({ sessions: [] }),
    },
  };
  const paths = Object.keys(fakes).map((m) => require.resolve(m));
  const saved = new Map();
  for (const resolved of paths) {
    if (require.cache[resolved]) saved.set(resolved, require.cache[resolved]);
  }
  for (const [spec, exportsObj] of Object.entries(fakes)) {
    const resolved = require.resolve(spec);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
  }
  const recorderResolved = require.resolve('../backend/recorder.cjs');
  const prevRecorder = require.cache[recorderResolved];
  delete require.cache[recorderResolved];
  process.env.USERPROFILE = home;
  process.env.HOME = home;

  const recorder = require('../backend/recorder.cjs');
  t.after(() => {
    if (prevProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevProfile;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    delete require.cache[recorderResolved];
    if (prevRecorder) require.cache[recorderResolved] = prevRecorder;
    for (const resolved of paths) {
      delete require.cache[resolved];
      if (saved.has(resolved)) require.cache[resolved] = saved.get(resolved);
    }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  });
  return recorder;
}

test('an AI-polish failure produces a visible warnings[] entry', async (t) => {
  const recorder = loadRecorderWithFailingPolish(t);
  const settings = {
    engine: 'deepgram', inputLanguage: 'en', translationEnabled: false,
    polishMode: 'light', aiPolish: true, translationProvider: 'gemini',
  };
  await recorder.startRecording(settings, []);
  const result = await recorder.stopRecording(settings, [], Buffer.alloc(8));
  await TICK();
  assert.deepEqual(result.warnings, ['ai-polish-failed'], 'the polish failure must be reported');
  assert.equal(result.text, 'Hello world.', 'the un-polished transcript is still delivered');
});

// ── Log file ────────────────────────────────────────────────────────────────

test('console output is mirrored into kimflow.log', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-log-'));
  t.after(() => {
    logging.resetFileLoggingForTests();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
  const logging = require('../backend/logging.cjs');
  logging.installFileLogging(dir);
  assert.equal(path.basename(logging.logFilePath() || ''), 'kimflow.log');
  console.error('[KimFlow] Widget renderer gone (gpu-process-crashed); recovery reload 1/3');
  const content = fs.readFileSync(path.join(dir, 'kimflow.log'), 'utf8');
  assert.match(content, /\[ERROR\] \[KimFlow\] Widget renderer gone \(gpu-process-crashed\)/);
  assert.match(content, /^\[\d{4}-\d{2}-\d{2}T/, 'lines carry an ISO timestamp');
  // A second install must be a no-op (no wrapper stacking).
  const before = fs.readFileSync(path.join(dir, 'kimflow.log'), 'utf8');
  logging.installFileLogging(os.tmpdir());
  console.warn('still-once');
  const after = fs.readFileSync(path.join(dir, 'kimflow.log'), 'utf8');
  assert.equal(after.split('still-once').length - 1, 1);
  void before;
});
