// test/hotkeys.test.cjs
//
// A capture hotkey may be a bare key ("1", "F5", "Space") or
// modifier(s) plus a key ("Ctrl+Shift+Space"). A lone modifier
// is not a hotkey, and neither is a non-modifier in a modifier
// slot.
const test = require('node:test');
const assert = require('node:assert');
const { isValidHotkey, normalizeHotkey } = require('../backend/hotkeys.cjs');

test('bare keys are valid hotkeys', () => {
  assert.equal(isValidHotkey('1'), true);
  assert.equal(isValidHotkey('a'), true);
  assert.equal(isValidHotkey('Z'), true);
  assert.equal(isValidHotkey('F5'), true);
  assert.equal(isValidHotkey('F12'), true);
  assert.equal(isValidHotkey('Space'), true);
  assert.equal(isValidHotkey('MediaPlayPause'), true);
});

test('modifier plus key combos remain valid', () => {
  assert.equal(isValidHotkey('Ctrl+Shift+Space'), true);
  assert.equal(isValidHotkey('Command+1'), true);
  assert.equal(isValidHotkey('Alt+F4'), true);
  assert.equal(isValidHotkey('CmdOrCtrl+Shift+Space'), true);
});

test('invalid hotkeys are rejected', () => {
  assert.equal(isValidHotkey(''), false);
  assert.equal(isValidHotkey('Control'), false);
  assert.equal(isValidHotkey('Shift'), false);
  assert.equal(isValidHotkey('Ctrl+'), false);
  assert.equal(isValidHotkey('Ctrl+Shift+'), false);
  assert.equal(isValidHotkey('Ctrl+Ctrl'), false);
  assert.equal(isValidHotkey('a+b'), false);
});

test('normalization maps platform aliases and keeps bare keys', () => {
  const normalized = normalizeHotkey('CmdOrCtrl+1');
  if (process.platform === 'darwin') {
    assert.equal(normalized, 'Command+1');
  } else {
    assert.equal(normalized, 'Control+1');
  }
  assert.equal(normalizeHotkey('1'), '1');
  assert.equal(normalizeHotkey('F5'), 'F5');
});
