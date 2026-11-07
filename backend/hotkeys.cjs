const { globalShortcut } = require('electron');

let onHotkeyPressed = null;
let activeHotkey = null;
// The hotkey as the user configured it, kept alongside the normalized form so
// a failed re-registration can restore exactly what was working before.
let configuredHotkey = null;

function normalizeHotkey(hotkey) {
  // Guard before any splitting: a hostile multi-megabyte string would otherwise
  // be split into millions of parts (F-12).
  if (typeof hotkey !== 'string' || hotkey.length > 80) return '';
  const aliases = {
    CmdOrCtrl: process.platform === 'darwin' ? 'Command' : 'Control',
    CommandOrControl: process.platform === 'darwin' ? 'Command' : 'Control',
    // Electron documents that the Command modifier has no effect on Windows
    // and Linux, so it must not be left there: a hotkey recorded on Windows
    // would silently bind the bare key.
    Cmd: process.platform === 'darwin' ? 'Command' : 'Control',
    Command: process.platform === 'darwin' ? 'Command' : 'Control',
    Ctrl: 'Control',
    Control: 'Control',
    // Electron's documented aliases for the platform's primary modifier.
    Meta: 'Super',
    Super: 'Super',
    Option: 'Alt',
    Alt: 'Alt',
    AltGr: 'AltGr',
    // Already canonical, but present so the case-insensitive lookup below
    // can also repair a manually typed lowercase "shift".
    Shift: 'Shift',
  };

  // Lookup is case-insensitive so a manually typed "ctrl+shift+d" maps its
  // modifiers just like "Ctrl+Shift+D" would.
  const aliasLookup = new Map(Object.entries(aliases).map(([name, canonical]) => [name.toLowerCase(), canonical]));

  const parts = String(hotkey || '').split('+');
  return parts
    .map((part, index) => {
      const mapped = aliasLookup.get(part.toLowerCase()) || part;
      if (index !== parts.length - 1) return mapped;
      // The final part is the key: canonicalize its casing so every stored,
      // registered and tested form is identical (Space, not space/SPACE).
      // NOTE: a real-Electron probe showed the accelerator parser accepts
      // mixed casing ("shift+space", " F2 " all register), so this repair is
      // NOT an OS constraint — it exists to give KimFlow a single canonical
      // form, and to keep our stricter-than-Electron whitelist from
      // rejecting what the user actually typed (which would silently keep
      // the OLD hotkey via the save-settings fallback).
      if (/^[a-z]$/.test(mapped)) return mapped.toUpperCase();
      if (/^f[0-9]{1,2}$/i.test(mapped)) return `F${mapped.slice(1)}`;
      const namedKey = NAMED_KEY_LOOKUP.get(mapped.toLowerCase());
      if (namedKey) return namedKey;
      return mapped;
    })
    .join('+');
}

// A hotkey is a bare key ("1", "F5", "Space") or modifier(s)
// plus a key ("Ctrl+Shift+Space"). Every part before the final
// key must be a modifier; a lone modifier is not a hotkey.
//
// The modifier set is exactly the one Electron's accelerator parser
// accepts, so a valid shortcut is never rejected by KimFlow.
const MODIFIERS = new Set([
  'Control', 'Command', 'Alt', 'AltGr', 'Option', 'Shift', 'Super', 'Meta',
  'Ctrl', 'Cmd', 'CmdOrCtrl', 'CommandOrControl',
]);
// Named keys Electron's accelerator parser understands, in canonical casing.
// Single source of truth for BOTH KEY_PATTERN (validation) and the final-key
// case repair in normalizeHotkey, so the whitelist and the repair can never
// drift apart.
const NAMED_KEYS = [
  'Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert',
  'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right',
  'MediaNextTrack', 'MediaPreviousTrack', 'MediaPlayPause',
  'VolumeUp', 'VolumeDown', 'VolumeMute',
];
// Lowercase name -> canonical form, for repairing typed casing ("space" ->
// "Space", "PAGEUP" -> "PageUp").
const NAMED_KEY_LOOKUP = new Map(NAMED_KEYS.map((name) => [name.toLowerCase(), name]));
const KEY_PATTERN = new RegExp(`^[A-Za-z0-9]$|^(F(?:[1-9]|1[0-2])|${NAMED_KEYS.join('|')})$`);

function isValidHotkey(hotkey) {
  // Reject absurdly long inputs up front (F-12) — before normalizeHotkey would
  // split them into millions of parts.
  if (typeof hotkey !== 'string' || hotkey.length > 80) return false;
  // Validate the NORMALIZED form, so a manually typed lowercase hotkey
  // ("f2", "ctrl+shift+d") is judged by what Electron will actually receive.
  const value = normalizeHotkey(hotkey).trim();
  if (!value || value.length > 80) return false;
  const parts = value.split('+');
  const key = parts[parts.length - 1];
  return KEY_PATTERN.test(key) && parts.slice(0, -1).every((part) => MODIFIERS.has(part));
}

/**
 * True when `hotkey` is a single key with NO modifier: F1-F12, a letter or
 * a digit. Such a hotkey is registered globally and intercepts the key in
 * EVERY application (F2 is Explorer rename, letters are in-app bindings),
 * which makes it the most conflict-prone choice. Reported, never blocked.
 */
function isBareKeyHotkey(hotkey) {
  const normalized = normalizeHotkey(hotkey);
  if (!normalized || normalized.includes('+')) return false;
  return /^[A-Z0-9]$|^F(?:[1-9]|1[0-2])$/.test(normalized);
}

function registerHotkeys(hotkey) {
  const normalized = normalizeHotkey(hotkey);
  if (!isValidHotkey(hotkey)) return false;
  if (!normalized) return false;
  const previous = activeHotkey;
  const previousConfigured = configuredHotkey;
  unregisterHotkeys();

  try {
    const registered = globalShortcut.register(normalized, () => {
      if (onHotkeyPressed) onHotkeyPressed();
    });
    if (registered) {
      activeHotkey = normalized;
      configuredHotkey = hotkey;
      if (isBareKeyHotkey(normalized)) {
        // Soft warning, not a block: the hotkey IS valid and registered.
        console.warn(`[KimFlow] Bare key "${normalized}" is registered globally and may conflict with other applications (e.g. F2 rename in Explorer, in-app bindings). A combination like Ctrl+Alt+${normalized} is less conflict-prone.`);
      }
      return true;
    }
    console.error(`[KimFlow] Hotkey could not be registered: ${normalized}`);
    restoreHotkey(previous, previousConfigured);
    return false;
  } catch (error) {
    console.error('[KimFlow] Failed to register hotkey:', error);
    restoreHotkey(previous, previousConfigured);
    return false;
  }
}

/**
 * Re-register the hotkey that was working before, if it still can be.
 *
 * `unregisterHotkeys()` has already released every shortcut, so the app is
 * left with NONE when the restore fails. Claiming the old hotkey anyway would
 * tell the user they have a working shortcut when they have none.
 */
function restoreHotkey(previous, previousConfigured) {
  if (!previous) {
    activeHotkey = null;
    configuredHotkey = null;
    return false;
  }
  let restored = false;
  try {
    restored = globalShortcut.register(previous, () => {
      if (onHotkeyPressed) onHotkeyPressed();
    });
  } catch {
    restored = false;
  }
  if (restored) {
    activeHotkey = previous;
    configuredHotkey = previousConfigured;
  } else {
    console.error(`[KimFlow] Previous hotkey could not be restored: ${previous}`);
    activeHotkey = null;
    configuredHotkey = null;
  }
  return restored;
}

/**
 * The hotkey currently registered, as the user configured it.
 *
 * Used to fall back to a working shortcut when a new one cannot be claimed,
 * so an unavailable hotkey never leaves the app without one.
 */
function getActiveHotkey() {
  return configuredHotkey || '';
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
  activeHotkey = null;
  configuredHotkey = null;
}

function setHotkeyCallbacks(pressed) {
  // Note: no release callback exists on purpose. OS global shortcuts only
  // fire on press — push-to-talk release is handled renderer-side, which
  // safely toggles instead (see handleTrigger in src/recording.ts).
  onHotkeyPressed = pressed;
}

module.exports = { registerHotkeys, unregisterHotkeys, setHotkeyCallbacks, normalizeHotkey, isValidHotkey, isBareKeyHotkey, getActiveHotkey };
