const { globalShortcut } = require('electron');

let onHotkeyPressed = null;
// Optional pause/resume hotkey callback. Null when no pause hotkey is
// configured — an absent callback never fires.
let onPauseHotkeyPressed = null;
let activeHotkey = null;
// The hotkeys as the user configured them, kept alongside the normalized
// forms so a failed re-registration can restore exactly what was working
// before — for BOTH shortcuts, because unregisterAll() releases the pair
// together.
let configuredHotkey = null;
let activePauseHotkey = null;
let configuredPauseHotkey = null;

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

/**
 * Register the optional pause/resume hotkey.
 *
 * An empty/absent value registers nothing — the pause hotkey is disabled by
 * default because a global shortcut intercepts its keys in EVERY application,
 * and KimFlow never claims one the user did not explicitly choose.
 *
 * Failure is SOFT: the capture hotkey is already registered by the time this
 * runs, so a taken pause combo must never break it. The caller may pass the
 * previously-working pause hotkey, which is restored when the new one cannot
 * be claimed.
 *
 * @param {string|undefined} pauseHotkey the configured pause hotkey ('' = off)
 * @param {string|null} previousPause normalized form of the pause hotkey that
 *   was working before unregisterAll()
 * @param {string|null} previousPauseConfigured configured form of the same
 * @returns {boolean} true when a pause hotkey is registered afterwards
 */
function registerPauseHotkey(pauseHotkey, previousPause, previousPauseConfigured) {
  const raw = typeof pauseHotkey === 'string' ? pauseHotkey.trim() : '';
  if (!raw) {
    // Disabled: drop whatever was registered before (unregisterAll already
    // released it) and keep it that way.
    activePauseHotkey = null;
    configuredPauseHotkey = null;
    return false;
  }
  const normalized = normalizeHotkey(raw);
  if (!isValidHotkey(raw) || !normalized) {
    console.warn(`[KimFlow] Ignoring invalid pause hotkey: ${raw}`);
    activePauseHotkey = null;
    configuredPauseHotkey = null;
    return restorePauseHotkey(previousPause, previousPauseConfigured);
  }
  try {
    const registered = globalShortcut.register(normalized, () => {
      if (onPauseHotkeyPressed) onPauseHotkeyPressed();
    });
    if (registered) {
      activePauseHotkey = normalized;
      configuredPauseHotkey = raw;
      return true;
    }
    console.warn(`[KimFlow] Pause hotkey could not be registered: ${normalized}. The capture hotkey is unaffected.`);
  } catch (error) {
    console.warn('[KimFlow] Failed to register pause hotkey:', error);
  }
  return restorePauseHotkey(previousPause, previousPauseConfigured);
}

/**
 * Re-register the pause hotkey that was working before, if there was one.
 * Soft failure: a pause hotkey that cannot come back is disabled with a
 * warning — the capture hotkey keeps working either way.
 */
function restorePauseHotkey(previousPause, previousPauseConfigured) {
  activePauseHotkey = null;
  configuredPauseHotkey = null;
  if (!previousPause) return false;
  let restored = false;
  try {
    restored = globalShortcut.register(previousPause, () => {
      if (onPauseHotkeyPressed) onPauseHotkeyPressed();
    });
  } catch {
    restored = false;
  }
  if (restored) {
    activePauseHotkey = previousPause;
    configuredPauseHotkey = previousPauseConfigured;
  } else {
    console.warn(`[KimFlow] Previous pause hotkey could not be restored: ${previousPause}`);
  }
  return restored;
}

/**
 * Register the capture hotkey and (optionally) the pause hotkey under ONE
 * unregister/restore cycle — `globalShortcut.unregisterAll()` is all-or-
 * nothing, so the two shortcuts must be managed as a pair.
 *
 * Failure semantics:
 * - Capture hotkey fails  -> the previous CAPTURE hotkey is restored (and the
 *   previous pause hotkey comes back with it); returns false. Existing
 *   fallback behaviour is preserved exactly.
 * - Pause hotkey fails    -> warn, restore the previous pause hotkey if there
 *   was one, and keep the new capture hotkey working; the overall call still
 *   returns true.
 * - Empty/absent pause hotkey -> nothing is registered for it.
 *
 * @param {string} hotkey the capture hotkey
 * @param {string|undefined} [pauseHotkey] optional pause/resume hotkey
 * @returns {boolean} true when the capture hotkey registered
 */
function registerHotkeys(hotkey, pauseHotkey) {
  const normalized = normalizeHotkey(hotkey);
  if (!isValidHotkey(hotkey)) return false;
  if (!normalized) return false;
  const previous = activeHotkey;
  const previousConfigured = configuredHotkey;
  const previousPause = activePauseHotkey;
  const previousPauseConfigured = configuredPauseHotkey;
  unregisterHotkeys();

  try {
    const registered = globalShortcut.register(normalized, () => {
      if (onHotkeyPressed) onHotkeyPressed();
    });
    if (!registered) {
      console.error(`[KimFlow] Hotkey could not be registered: ${normalized}`);
      restoreHotkey(previous, previousConfigured, previousPause, previousPauseConfigured);
      return false;
    }
    activeHotkey = normalized;
    configuredHotkey = hotkey;
    if (isBareKeyHotkey(normalized)) {
      // Soft warning, not a block: the hotkey IS valid and registered.
      console.warn(`[KimFlow] Bare key "${normalized}" is registered globally and may conflict with other applications (e.g. F2 rename in Explorer, in-app bindings). A combination like Ctrl+Alt+${normalized} is less conflict-prone.`);
    }
    // Best-effort second shortcut: its failure never undoes the capture
    // hotkey that just registered successfully.
    registerPauseHotkey(pauseHotkey, previousPause, previousPauseConfigured);
    return true;
  } catch (error) {
    console.error('[KimFlow] Failed to register hotkey:', error);
    restoreHotkey(previous, previousConfigured, previousPause, previousPauseConfigured);
    return false;
  }
}

/**
 * Re-register the hotkey that was working before, if it still can be.
 *
 * `unregisterHotkeys()` has already released every shortcut, so the app is
 * left with NONE when the restore fails. Claiming the old hotkey anyway would
 * tell the user they have a working shortcut when they have none.
 *
 * The pause hotkey is part of the same unregister cycle, so it is restored
 * (or deliberately dropped) alongside the capture hotkey.
 */
function restoreHotkey(previous, previousConfigured, previousPause, previousPauseConfigured) {
  if (!previous) {
    activeHotkey = null;
    configuredHotkey = null;
  } else {
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
  }
  restorePauseHotkey(previousPause, previousPauseConfigured);
}

/**
 * The capture hotkey currently registered, as the user configured it.
 *
 * Used to fall back to a working shortcut when a new one cannot be claimed,
 * so an unavailable hotkey never leaves the app without one.
 */
function getActiveHotkey() {
  return configuredHotkey || '';
}

/**
 * The pause hotkey currently registered, as the user configured it.
 * '' when no pause hotkey is registered (disabled by default, or the last
 * registration attempt failed and no previous pause hotkey could come back).
 */
function getActivePauseHotkey() {
  return configuredPauseHotkey || '';
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
  activeHotkey = null;
  configuredHotkey = null;
  activePauseHotkey = null;
  configuredPauseHotkey = null;
}

/**
 * Set the shortcut callbacks. `pressed` fires for the capture hotkey;
 * `pausePressed` (optional) fires for the pause/resume hotkey.
 */
function setHotkeyCallbacks(pressed, pausePressed) {
  // Note: no release callback exists on purpose. OS global shortcuts only
  // fire on press — push-to-talk release is handled renderer-side, which
  // safely toggles instead (see handleTrigger in src/recording.ts).
  onHotkeyPressed = pressed;
  onPauseHotkeyPressed = typeof pausePressed === 'function' ? pausePressed : null;
}

module.exports = { registerHotkeys, unregisterHotkeys, setHotkeyCallbacks, normalizeHotkey, isValidHotkey, isBareKeyHotkey, getActiveHotkey, getActivePauseHotkey };
