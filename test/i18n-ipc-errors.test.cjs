'use strict';
// Independent verification of the IPC error fix in `src/utils.ts`.
//
// Electron 33.4.11 builds the renderer rejection as:
//   `Error invoking remote method '<channel>': ` + thrownError.toString()
// (verified in the bundled electron.exe: the renderer does
// `throw new Error(\`Error invoking remote method '${channel}': ${error}\`)`
// and the main process replies with `{ error: t.toString() }`). For a plain
// `Error('X')`, `toString()` is `'Error: X'`, so the wire message carries TWO
// prefixes. `IPC_ERROR_PREFIX` must strip both, and only at the start.

const test = require('node:test');
const assert = require('node:assert');

const { loadTs } = require('./helpers/ts-loader.cjs');
const { friendlyMessageFor } = require('../backend/friendly-errors.cjs');

// Share one module graph so `setLanguage` on the i18n handle affects `utils`.
const cache = new Map();
const i18n = loadTs('src/i18n/index.ts', undefined, cache);
const utils = loadTs('src/utils.ts', undefined, cache);
const EN = loadTs('src/i18n/locales/en.ts').en;
const AR = loadTs('src/i18n/locales/ar.ts').ar;
const ZH = loadTs('src/i18n/locales/zh.ts').zh;

const CHANNEL = 'stop-recording';

/** Reproduce the exact wire message the renderer receives for a thrown error. */
function wire(error, channel = CHANNEL) {
  return new Error(`Error invoking remote method '${channel}': ${error.toString()}`);
}

function inLanguage(language, fn) {
  const previous = i18n.getLanguage();
  i18n.setLanguage(language);
  try { return fn(); } finally { i18n.setLanguage(previous); }
}

// ── The wire format itself ──────────────────────────────────────────────────

test('errorText strips both IPC prefixes from the real wire format', () => {
  assert.equal(utils.errorText(wire(new Error('X'))), 'X');
  assert.equal(utils.errorText(wire(new Error('X'), 'test-deepgram-connection')), 'X');
});

test('errorText strips named-error prefixes (AbortError / TranslationError)', () => {
  const abort = new Error('Transcription aborted');
  abort.name = 'AbortError';
  assert.equal(utils.errorText(wire(abort)), 'Transcription aborted');

  const translation = new Error('Gemini API request failed: fetch failed');
  translation.name = 'TranslationError';
  assert.equal(utils.errorText(wire(translation)), 'Gemini API request failed: fetch failed');
});

test('errorText leaves a message that is NOT an IPC rejection untouched', () => {
  // A renderer-thrown error has no wrapper; the anchored regex must not eat it.
  assert.equal(utils.errorText(new Error('Unable to copy transcript')), 'Unable to copy transcript');
  assert.equal(utils.errorText(new Error('Error: leading name only')), 'Error: leading name only');
});

test('the regex is anchored: a mid-string "Error:" is preserved', () => {
  assert.equal(
    utils.errorText(wire(new Error('Custom failure: Error: inner cause'))),
    'Custom failure: Error: inner cause',
  );
});

// ── The ~12 backend user-facing strings ─────────────────────────────────────

// Representative backend failures mapped through the real friendly-errors table
// to the English sentence the backend throws, and the locale key it must become.
const BACKEND_CASES = [
  { name: 'micBlocked', error: Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }), key: 'error.micBlocked' },
  { name: 'micNotFound', error: Object.assign(new Error('requested device not found'), { name: 'NotFoundError' }), key: 'error.micNotFound' },
  { name: 'micBusy', error: new Error('NotReadableError: device busy'), key: 'error.micBusy' },
  { name: 'whisperBinaryNotFound', error: Object.assign(new Error('spawn whisper-cli ENOENT'), { code: 'ENOENT' }), key: 'error.whisperBinaryNotFound' },
  { name: 'whisperNotExecutable', error: Object.assign(new Error('spawn whisper-cli failed'), { code: 'EACCES' }), key: 'error.whisperNotExecutable' },
  { name: 'whisperModelNotFound', error: new Error('model not found'), key: 'error.whisperModelNotFound' },
  { name: 'whisperCrashed', error: new Error('whisper crashed 0xC0000005'), key: 'error.whisperCrashed' },
  { name: 'invalidApiKey', error: new Error('HTTP 401 Unauthorized'), key: 'error.invalidApiKey' },
  { name: 'apiKeyMissing', error: new Error('api key not set'), key: 'error.apiKeyMissing' },
  { name: 'network', error: new Error('ENOTFOUND api host'), key: 'error.network' },
  { name: 'noSpeech', error: new Error('empty transcript: no speech'), key: 'error.noSpeech' },
  { name: 'transcriptionFailedDetail', error: new Error('whisper.cpp failed with stderr: boom'), key: 'error.transcriptionFailedDetail' },
];

test('the backend produces the exact English locale strings (12 cases)', () => {
  assert.equal(BACKEND_CASES.length, 12);
  for (const { name, error, key } of BACKEND_CASES) {
    assert.equal(friendlyMessageFor(error), EN[key], `${name}: backend string must equal en[${key}]`);
  }
});

test('each backend string maps to its locale key through the IPC wire (en + ar)', () => {
  for (const { name, error, key } of BACKEND_CASES) {
    const backendString = friendlyMessageFor(error);
    const rejection = wire(new Error(backendString));
    assert.equal(utils.errorText(rejection), backendString, `${name}: cleaned text mismatch`);
    assert.equal(inLanguage('en', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), EN[key], `${name}: en render`);
    assert.equal(inLanguage('ar', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), AR[key], `${name}: ar render`);
    assert.equal(inLanguage('zh', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), ZH[key], `${name}: zh render`);
  }
});

test('every en error.* string round-trips back to its own key', () => {
  for (const [key, value] of Object.entries(EN)) {
    if (!key.startsWith('error.')) continue;
    const rendered = inLanguage('ar', () => utils.friendlyError(wire(new Error(value)), 'error.transcriptionFailed'));
    assert.equal(rendered, AR[key], `${key} did not round-trip to its own key`);
  }
});

// ── Abort → silent, TranslationError → network ──────────────────────────────

test('AbortError maps to "" (silent)', () => {
  const abort = new Error('Transcription aborted');
  abort.name = 'AbortError';
  assert.equal(utils.friendlyError(wire(abort), 'error.transcriptionFailed'), '');
  // The renderer-local flag form is also silent.
  assert.equal(utils.friendlyError({ aborted: true }, 'error.transcriptionFailed'), '');
});

test('TranslationError maps to error.network', () => {
  const translation = new Error('Gemini API request failed: fetch failed');
  translation.name = 'TranslationError';
  const rejection = wire(translation);
  assert.ok(!utils.errorText(rejection).includes('TranslationError'), 'the name prefix must be stripped');
  assert.equal(inLanguage('en', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), EN['error.network']);
  assert.equal(inLanguage('ar', () => utils.friendlyError(rejection, 'error.transcriptionFailed')), AR['error.network']);
});

// ── Connection-test failures (also backend-thrown over IPC) ─────────────────

test('connection-test failures never leak English and map sensibly', () => {
  const cases = [
    { message: 'Deepgram connection failed: Invalid API key', key: 'error.invalidApiKey' },
    { message: 'Deepgram connection failed: getaddrinfo ENOTFOUND api.deepgram.com', key: 'error.network' },
    { message: 'Speechmatics connection failed: Unexpected status: 500', key: 'error.connectionFailed' },
  ];
  for (const { message, key } of cases) {
    const rejection = wire(new Error(message), 'test-deepgram-connection');
    const rendered = inLanguage('ar', () => utils.friendlyError(rejection, 'error.connectionFailed'));
    assert.equal(rendered, AR[key], `${message} should render ${key}`);
  }
});

// ── Fallback behaviour ──────────────────────────────────────────────────────

test('an unrecognised error falls back to the caller-provided key', () => {
  const rejection = wire(new Error('totally unexpected backend condition zzz'));
  assert.equal(inLanguage('ar', () => utils.friendlyError(rejection, 'error.saveSettings')), AR['error.saveSettings']);
});

test('errorMessage returns the translated fallback when nothing matches', () => {
  const rejection = wire(new Error('totally unexpected backend condition zzz'));
  assert.equal(inLanguage('ar', () => utils.errorMessage(rejection, 'error.loadSettings')), AR['error.loadSettings']);
});
