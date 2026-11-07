// test/hotkeys.test.cjs
//
// A capture hotkey may be a bare key ("1", "F5", "Space") or
// modifier(s) plus a key ("Ctrl+Shift+Space"). A lone modifier
// is not a hotkey, and neither is a non-modifier in a modifier
// slot.
const test = require('node:test');
const assert = require('node:assert');

// Electron stub injected BEFORE hotkeys.cjs loads, so registerHotkeys can be
// exercised in the bare node test runner. node --test runs each file in its
// own process, so this require.cache injection cannot leak into other suites.
const registeredAccelerators = [];
let stubRegisterResult = true;
let electronStubbed = false;
try {
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      globalShortcut: {
        register: (accelerator) => {
          registeredAccelerators.push(accelerator);
          return stubRegisterResult;
        },
        unregisterAll: () => { registeredAccelerators.length = 0; },
      },
    },
  };
  electronStubbed = true;
} catch { /* electron could not be resolved */ }

// Fail loudly instead of silently skipping: a registerHotkeys test that does
// not run is a false green, not a pass.
assert.ok(electronStubbed, 'the electron globalShortcut stub must be installed for registerHotkeys tests');

const { isValidHotkey, normalizeHotkey, isBareKeyHotkey, registerHotkeys, unregisterHotkeys } = require('../backend/hotkeys.cjs');

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

// --- QA adversarial round (Edward) -------------------------------------------
//
// Grounded in a real-Electron probe (Electron v33, globalShortcut.register):
// 'shift+space', 'SHIFT+space', ' F2 ', 'f2' and even 'F13' all register
// successfully, i.e. the real accelerator parser is case-insensitive and
// whitespace-tolerant. The assertions below pin the behaviours that matter.

test('QA: normalization table', () => {
  assert.equal(normalizeHotkey('f2'), 'F2');
  assert.equal(normalizeHotkey('f12'), 'F12');
  assert.equal(normalizeHotkey('F12'), 'F12', 'already-canonical f-key unchanged');
  assert.equal(normalizeHotkey('option+a'), 'Alt+A');
  assert.equal(normalizeHotkey('meta+k'), 'Super+K');
  if (process.platform === 'win32') {
    // The documented no-op-Command rule: Cmd has no effect off macOS.
    assert.equal(normalizeHotkey('ctrl+shift+d'), 'Control+Shift+D');
    assert.equal(normalizeHotkey('cmd+shift+d'), 'Control+Shift+D');
  } else if (process.platform === 'darwin') {
    assert.equal(normalizeHotkey('cmd+shift+d'), 'Command+Shift+D');
  }
});

test('QA: garbage stays rejected after normalization', () => {
  assert.equal(isValidHotkey('Dead'), false);
  assert.equal(isValidHotkey('F13'), false, 'F13 is outside the F1-F12 scope');
  assert.equal(isValidHotkey('Ctrl+'), false);
  assert.equal(isValidHotkey(''), false);
  assert.equal(isValidHotkey('A'.repeat(81)), false, 'over the 80-char bound');
  assert.equal(isValidHotkey('Control+' + 'A'.repeat(81)), false);
});

test('QA: isBareKeyHotkey table', () => {
  assert.equal(isBareKeyHotkey('F2'), true);
  assert.equal(isBareKeyHotkey('A'), true);
  assert.equal(isBareKeyHotkey('5'), true);
  assert.equal(isBareKeyHotkey('Control+F2'), false);
  assert.equal(isBareKeyHotkey('Shift+Space'), false);
  assert.equal(isBareKeyHotkey('Dead'), false);
  assert.equal(isBareKeyHotkey('F13'), false);
  assert.equal(isBareKeyHotkey(''), false);
});

test('QA: modifier aliases are matched case-insensitively', () => {
  assert.equal(normalizeHotkey('CTRL+ALT+D'), 'Control+Alt+D');
  assert.equal(normalizeHotkey('control+alt+d'), 'Control+Alt+D');
  assert.equal(isValidHotkey('ALT+F4'), true);
});

test('QA: spaced combos are rejected and normalize/isValid agree', () => {
  assert.equal(isValidHotkey('ctrl + alt + d'), false);
  assert.equal(isValidHotkey(normalizeHotkey('ctrl + alt + d')), false,
    'validation must agree with the form that would be registered');
});

test('QA: whitespace-padded bare key passes validation, matching real Electron', () => {
  // isValidHotkey trims before validating; registerHotkeys would hand the
  // untrimmed form to Electron. The real-Electron probe registered ' F2 '
  // successfully, so validation and registration agree — pinned here.
  assert.equal(isValidHotkey(' F2 '), true);
});

// QA-1 FIXED: the final-key case repair in backend/hotkeys.cjs now
// canonicalizes any final part whose case-insensitive form is in the shared
// NAMED_KEYS list (Space, Enter, PageUp, ...), built from the same constant
// as KEY_PATTERN. The real-Electron probe proved Electron accepts mixed
// casing itself; we canonicalize so our stricter whitelist never rejects
// what the user typed (which would silently keep the OLD hotkey).
test('named keys are canonicalized regardless of typed casing (QA-1)', () => {
  assert.equal(normalizeHotkey('shift+space'), 'Shift+Space');
  assert.equal(isValidHotkey('shift+space'), true, '"shift+space" must not hit the silent fallback');
  assert.equal(isValidHotkey('SHIFT+SPACE'), true);
  assert.equal(isValidHotkey('ctrl+enter'), true);
  assert.equal(normalizeHotkey('ctrl+enter'), 'Control+Enter');
  assert.equal(normalizeHotkey('SHIFT+SPACE'), 'Shift+Space');
  assert.equal(normalizeHotkey('pageup'), 'PageUp');
  assert.equal(isValidHotkey('PageUp'), true);
  // Garbage stays rejected: the repair only touches known named keys.
  assert.equal(isValidHotkey('Dead'), false);
  assert.equal(isValidHotkey('F13'), false);
  assert.equal(isValidHotkey('Ctrl+'), false);
  assert.equal(isValidHotkey('ctrl+spacebar'), false);
});

test('QA: registerHotkeys registers the NORMALIZED accelerator', () => {
  registeredAccelerators.length = 0;
  try {
    assert.equal(registerHotkeys('f2'), true);
    assert.deepEqual(registeredAccelerators, ['F2'],
      'Electron must receive the repaired form, not the typed one');
  } finally {
    unregisterHotkeys();
  }
});

test('QA: a bare registered key warns exactly once, non-blocking', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    assert.equal(registerHotkeys('f2'), true, 'the bare key still registers');
    assert.equal(warnings.length, 1, 'exactly one bare-key warning');
    assert.match(warnings[0], /F2/);
    warnings.length = 0;
    assert.equal(registerHotkeys('Control+F2'), true);
    assert.equal(warnings.length, 0, 'a modifier combo never warns');
  } finally {
    console.warn = originalWarn;
    unregisterHotkeys();
  }
});

test('QA: a FAILED registration never emits the bare-key warning', () => {
  stubRegisterResult = false;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    assert.equal(registerHotkeys('F5'), false);
    assert.equal(warnings.length, 0, 'no success warning when registration failed');
  } finally {
    stubRegisterResult = true;
    console.warn = originalWarn;
    unregisterHotkeys();
  }
});
