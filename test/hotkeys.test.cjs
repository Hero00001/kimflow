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

// --- Case robustness ---------------------------------------------------------
//
// A hotkey typed in lowercase ("f2", "ctrl+shift+d") must behave EXACTLY like
// its uppercase form: Electron's accelerator parser only accepts uppercase
// f-keys and single uppercase letters, so a lowercase hotkey used to fail
// validation, "fail" registration, and the save-settings fallback silently
// kept the OLD hotkey.

test('a lowercase f-key is normalized to Electron form', () => {
  assert.equal(normalizeHotkey('f2'), 'F2');
  assert.equal(normalizeHotkey('f12'), 'F12');
  assert.equal(normalizeHotkey('F12'), 'F12', 'already-correct f-keys are unchanged');
  assert.equal(normalizeHotkey('alt+f4'), 'Alt+F4');
});

test('a lowercase single-letter key is normalized to uppercase', () => {
  assert.equal(normalizeHotkey('n'), 'N');
  assert.equal(normalizeHotkey('ctrl+shift+d'), process.platform === 'darwin' ? 'Command+Shift+D' : 'Control+Shift+D');
  assert.equal(normalizeHotkey('Ctrl+N'), 'Control+N');
  // Modifiers themselves are canonicalized, not capitalized as keys.
  assert.equal(normalizeHotkey('shift'), 'Shift');
  // ...and a lone modifier still is not a hotkey.
  assert.equal(isValidHotkey('shift'), false);
});

test('lowercase hotkeys pass validation through the normalized form', () => {
  assert.equal(isValidHotkey('f2'), true, '"f2" must register as "F2"');
  assert.equal(isValidHotkey('ctrl+n'), true);
  assert.equal(isValidHotkey('ctrl+shift+d'), true);
  assert.equal(isValidHotkey('F12'), true);
  // Still rejected: normalizing must not loosen the key whitelist.
  assert.equal(isValidHotkey('ctrl+notakey'), false);
  assert.equal(isValidHotkey('a+b'), false);
});

// --- Bare-key warning --------------------------------------------------------

test('bare single keys are detected for the conflict warning', () => {
  const { isBareKeyHotkey } = require('../backend/hotkeys.cjs');
  assert.equal(isBareKeyHotkey('F2'), true);
  assert.equal(isBareKeyHotkey('f2'), true, 'case-normalized first');
  assert.equal(isBareKeyHotkey('a'), true);
  assert.equal(isBareKeyHotkey('1'), true);
  assert.equal(isBareKeyHotkey('Space'), false, 'named keys are not in the warn set');
  assert.equal(isBareKeyHotkey('Ctrl+Shift+Space'), false);
  assert.equal(isBareKeyHotkey('Alt+F4'), false);
  assert.equal(isBareKeyHotkey(''), false);
});
