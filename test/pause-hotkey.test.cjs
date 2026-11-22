'use strict';
// test/pause-hotkey.test.cjs
//
// The pause/resume hotkey is OPTIONAL and OFF by default. A global shortcut
// intercepts its keys in EVERY application, so:
//   1. settings.cjs stores '' (disabled) as the default and preserves an
//      empty value — unlike the capture hotkey, empty is a valid state, not
//      a fallback trigger;
//   2. main.cjs registers it alongside the capture hotkey only when the user
//      configured one, and toggles pause/resume by recorder state on press.
//
// Validation of the hotkey FORMAT reuses hotkeys.cjs (isValidHotkey /
// normalizeHotkey) at registration time — the same machinery the capture
// hotkey uses — while normalization here only trims and length-guards.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEFAULT_SETTINGS, normalizeSettings } = require('../backend/settings.cjs');
const { isValidHotkey, normalizeHotkey } = require('../backend/hotkeys.cjs');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

// ── 1. defaults and coercion (backend/settings.cjs) ─────────────────────────

test('the pause hotkey defaults to disabled', () => {
  assert.equal(DEFAULT_SETTINGS.pauseHotkey, '');
  assert.equal(normalizeSettings({}).pauseHotkey, '');
  assert.equal(normalizeSettings(null).pauseHotkey, '');
});

test('an empty pause hotkey stays empty (disabled), unlike the capture hotkey', () => {
  assert.equal(normalizeSettings({ pauseHotkey: '' }).pauseHotkey, '');
  assert.equal(normalizeSettings({ pauseHotkey: '   ' }).pauseHotkey, '');
  // The capture hotkey falls back to its default when emptied; the pause
  // hotkey must NOT copy that behaviour or disabling would be impossible.
  assert.notEqual(DEFAULT_SETTINGS.hotkey, '');
  assert.equal(normalizeSettings({ hotkey: '' }).hotkey, DEFAULT_SETTINGS.hotkey);
});

test('a valid pause hotkey is preserved (trimmed)', () => {
  assert.equal(normalizeSettings({ pauseHotkey: 'Ctrl+Alt+P' }).pauseHotkey, 'Ctrl+Alt+P');
  assert.equal(normalizeSettings({ pauseHotkey: '  Ctrl+Alt+P ' }).pauseHotkey, 'Ctrl+Alt+P');
  // The stored value is validated with the SAME machinery as the capture
  // hotkey at registration time.
  assert.equal(isValidHotkey(normalizeSettings({ pauseHotkey: 'ctrl+alt+p' }).pauseHotkey), true);
  assert.equal(normalizeHotkey('ctrl+alt+p'), 'Control+Alt+P');
});

test('an oversized pause hotkey coerces to disabled', () => {
  assert.equal(normalizeSettings({ pauseHotkey: 'A'.repeat(81) }).pauseHotkey, '');
  assert.equal(normalizeSettings({ pauseHotkey: 'Ctrl+' + 'A'.repeat(81) }).pauseHotkey, '');
});

test('a non-string pause hotkey coerces to disabled', () => {
  assert.equal(normalizeSettings({ pauseHotkey: 12345 }).pauseHotkey, '');
  assert.equal(normalizeSettings({ pauseHotkey: { combo: 'Ctrl+Alt+P' } }).pauseHotkey, '');
  assert.equal(normalizeSettings({ pauseHotkey: ['Ctrl', 'Alt', 'P'] }).pauseHotkey, '');
});

test('format checking stays at registration time, like the capture hotkey', () => {
  // normalizeSettings does not reject malformed values (it only trims and
  // length-guards); hotkeys.cjs's isValidHotkey rejects them when the pair
  // is registered. This mirrors the capture hotkey exactly.
  const stored = normalizeSettings({ pauseHotkey: 'Ctrl+' }).pauseHotkey;
  assert.equal(stored, 'Ctrl+');
  assert.equal(isValidHotkey(stored), false);
});

// ── 2. main-process wiring (main.cjs under the electron harness) ────────────

function withTempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-pause-'));
  t.after(() => { try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ } });
  return home;
}

/**
 * A hotkeys stub that records what main.cjs requested. The registration
 * itself always succeeds; the recorded calls and callbacks let a test assert
 * the startup wiring without a real Electron globalShortcut.
 */
function recordingHotkeysStub() {
  const calls = { registrations: [], callbacks: [] };
  return {
    _calls: calls,
    registerHotkeys(hotkey, pauseHotkey) {
      calls.registrations.push([hotkey, pauseHotkey]);
      return true;
    },
    unregisterHotkeys() {},
    setHotkeyCallbacks(pressed, pausePressed) {
      calls.callbacks.push([pressed, pausePressed]);
    },
    isValidHotkey: () => true,
    getActiveHotkey: () => '',
    getActivePauseHotkey: () => '',
  };
}

test('startup registers the configured pause hotkey together with the capture hotkey', async (t) => {
  const home = withTempHome(t);
  const hotkeys = recordingHotkeysStub();
  const harness = await loadMain({
    locale: 'en-US',
    home,
    settings: { pauseHotkey: 'Ctrl+Alt+P' },
    overrides: { 'hotkeys.cjs': hotkeys },
  });
  t.after(() => harness.restore());

  assert.equal(hotkeys._calls.registrations.length, 1, 'one registration cycle at startup');
  const [capture, pause] = hotkeys._calls.registrations[0];
  assert.equal(capture, 'CmdOrCtrl+Shift+Space', 'the default capture hotkey');
  assert.equal(pause, 'Ctrl+Alt+P', 'the configured pause hotkey travels with it');
  assert.equal(hotkeys._calls.callbacks.length, 1, 'callbacks are set once');
  const [pressed, pausePressed] = hotkeys._calls.callbacks[0];
  assert.equal(typeof pressed, 'function', 'capture callback');
  assert.equal(typeof pausePressed, 'function', 'pause callback is wired');
});

test('an unconfigured pause hotkey registers nothing at startup', async (t) => {
  const home = withTempHome(t);
  const hotkeys = recordingHotkeysStub();
  const harness = await loadMain({
    locale: 'en-US',
    home,
    overrides: { 'hotkeys.cjs': hotkeys },
  });
  t.after(() => harness.restore());

  const [, pause] = hotkeys._calls.registrations[0];
  assert.ok(pause === '' || pause === undefined, 'no pause hotkey was requested (empty/absent)');
});

test('the pause hotkey press toggles pause/resume by recorder state', async (t) => {
  const home = withTempHome(t);
  const hotkeys = recordingHotkeysStub();
  // A recorder stub whose state the test drives, so the toggle logic in
  // main.cjs can be exercised for every state without a real microphone.
  const recorderCalls = { pause: 0, resume: 0 };
  let state = 'recording';
  const recorder = {
    startRecording: async () => {},
    stopRecording: async () => ({ aborted: true }),
    pauseRecording: async () => { recorderCalls.pause += 1; },
    resumeRecording: async () => { recorderCalls.resume += 1; },
    cancelRecording: async () => {},
    getState: () => state,
    STATE: { READY: 'ready', RECORDING: 'recording', PAUSED: 'paused', TRANSCRIBING: 'transcribing' },
  };
  const harness = await loadMain({
    locale: 'en-US',
    home,
    settings: { pauseHotkey: 'Ctrl+Alt+P' },
    overrides: { 'hotkeys.cjs': hotkeys, 'recorder.cjs': recorder },
  });
  t.after(() => harness.restore());

  const [, pausePressed] = hotkeys._calls.callbacks[0];
  assert.equal(typeof pausePressed, 'function');

  pausePressed();
  assert.equal(recorderCalls.pause, 1, 'recording -> pause');
  assert.equal(recorderCalls.resume, 0);

  state = 'paused';
  pausePressed();
  assert.equal(recorderCalls.resume, 1, 'paused -> resume');

  for (const idleState of ['ready', 'transcribing']) {
    state = idleState;
    pausePressed();
  }
  assert.equal(recorderCalls.pause, 1, 'ready/transcribing are no-ops');
  assert.equal(recorderCalls.resume, 1, 'ready/transcribing are no-ops');
});
