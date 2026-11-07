'use strict';
// test/ipc-contract-b10.test.cjs
//
// The IPC contract, pinned (A9 / B10 step 1):
//   1. every channel the preload BRIDGES (invoke/send/subscribe) must have a
//      main-process counterpart (handle/on/send),
//   2. every main-process handler/listener/push must be reachable from the
//      preload — no dead channels,
//   3. the push channel set is exactly what the preload subscribes to.
//
// This is a source-contract test: it parses main.cjs and preload.cjs and
// fails the moment one side grows a channel the other side does not know —
// including the dead 'toggle-recording'/'list-microphones' pair that lived
// unnoticed until the B8 audit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readSource = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Every file allowed to push to a window. A new pusher must be added here —
// the exact-set pin below will fail otherwise.
const MAIN_PROCESS_PUSH_FILES = [
  'main.cjs',
  'backend/recorder.cjs',
  'backend/model-download.cjs',
  'backend/engine-download.cjs',
];
const mainSource = readSource('main.cjs');
const preloadSource = readSource('preload.cjs');
const pushSources = MAIN_PROCESS_PUSH_FILES.map(readSource);

function unique(list) {
  return [...new Set(list)].sort();
}

// ── main-process side ───────────────────────────────────────────────────────

const mainHandled = unique([...mainSource.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]));
const mainListeners = unique([...mainSource.matchAll(/ipcMain\.on\(\s*'([^']+)'/g)].map((m) => m[1]));
// Pushes: literal channels sent to windows from any main-process file.
const mainPushes = unique(pushSources.flatMap((source) => [
  ...[...source.matchAll(/sendToWindows\(\s*'([^']+)'/g)].map((m) => m[1]),
  ...[...source.matchAll(/webContents\.send\(\s*'([^']+)'/g)].map((m) => m[1]),
  ...[...source.matchAll(/sendToWindow\(window,\s*'([^']+)'/g)].map((m) => m[1]),
]));

// ── preload side ────────────────────────────────────────────────────────────

const preloadInvokes = unique([...preloadSource.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]));
const preloadSends = unique([...preloadSource.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map((m) => m[1]));
const preloadSubscribes = unique([...preloadSource.matchAll(/subscribe\(\s*'([^']+)'/g)].map((m) => m[1]));

// ── the contract ────────────────────────────────────────────────────────────

test('every bridged invoke has a main-process handler, and vice versa', () => {
  const orphanInvokes = preloadInvokes.filter((c) => !mainHandled.includes(c));
  assert.deepEqual(orphanInvokes, [], 'preload invokes without an ipcMain.handle');
  const deadHandlers = mainHandled.filter((c) => !preloadInvokes.includes(c));
  assert.deepEqual(deadHandlers, [], 'ipcMain.handle channels no renderer can reach (dead)');
});

test('every preload send has an ipcMain.on listener, and vice versa', () => {
  const orphanSends = preloadSends.filter((c) => !mainListeners.includes(c));
  assert.deepEqual(orphanSends, [], 'preload sends without an ipcMain.on');
  const deadListeners = mainListeners.filter((c) => !preloadSends.includes(c));
  assert.deepEqual(deadListeners, [], 'ipcMain.on channels no renderer can reach (dead)');
});

test('push channels and preload subscriptions match exactly', () => {
  const unsubscribed = mainPushes.filter((c) => !preloadSubscribes.includes(c));
  assert.deepEqual(unsubscribed, [], 'main pushes a channel the preload never subscribes to');
  const unsent = preloadSubscribes.filter((c) => !mainPushes.includes(c));
  assert.deepEqual(unsent, [], 'the preload subscribes to a channel main never pushes');
});

test('the documented live channel set is exactly this (guards the contract itself)', () => {
  assert.deepEqual(mainHandled, [
    'activate-engine',
    'cancel-recording',
    'check-model-downloaded',
    'check-whisper-binary',
    'clear-history',
    'delete-secret',
    'detect-gpu',
    'download-engine',
    'download-model',
    'engine-status',
    'get-history',
    'get-recording-state',
    'get-settings',
    'has-secret',
    'list-translation-languages',
    'overlay-action',
    'pause-recording',
    'resume-recording',
    'save-settings',
    'secret-state',
    'select-whisper-binary',
    'start-recording',
    'stop-recording',
    'test-deepgram-connection',
    'test-speechmatics-connection',
    'validate-gemini-model',
    'window-control',
    'write-clipboard',
  ]);
  assert.deepEqual(mainListeners, ['mic-level']);
  assert.deepEqual(mainPushes, [
    'download-progress',
    'history-updated',
    'hotkey-pressed',
    'overlay-action',
    'recording-state',
    'recording-time-limit',
    'settings-updated',
    'transcription-result',
    'widget-level',
  ]);
});

// ── B10 step 5 (partial): the packaging contract ────────────────────────────

test('the built overlay page is a bundled entry, not the inert source page', () => {
  const built = path.join(ROOT, 'dist', 'src', 'overlay.html');
  if (!fs.existsSync(built)) {
    assert.fail('dist/src/overlay.html is missing — run `npm run build` before the suite (the CI does)');
  }
  const html = fs.readFileSync(built, 'utf8');
  // The source page references /src/overlay.ts, which is inert over file://
  // (A7): a packaged build that shipped THIS page would render a blank
  // overlay with a green suite.
  assert.doesNotMatch(html, /src\/overlay\.ts/, 'the inert TypeScript entry must never be shipped');
  assert.match(html, /assets\/overlay-[A-Za-z0-9_-]+\.js/, 'the overlay must reference its bundled asset');
});
