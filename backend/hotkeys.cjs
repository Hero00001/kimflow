const { globalShortcut } = require('electron');

let onHotkeyPressed = null;
let activeHotkey = null;
// The hotkey as the user configured it, kept alongside the normalized form so
// a failed re-registration can restore exactly what was working before.
let configuredHotkey = null;

function normalizeHotkey(hotkey) {
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
  };

  return String(hotkey || '')
    .split('+')
    .map((part) => aliases[part] || part)
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
const KEY_PATTERN = /^[A-Za-z0-9]$|^(F(?:[1-9]|1[0-2])|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|MediaNextTrack|MediaPreviousTrack|MediaPlayPause|VolumeUp|VolumeDown|VolumeMute)$/;

function isValidHotkey(hotkey) {
  const value = String(hotkey || '').trim();
  if (!value || value.length > 80) return false;
  const parts = value.split('+');
  const key = parts[parts.length - 1];
  return KEY_PATTERN.test(key) && parts.slice(0, -1).every((part) => MODIFIERS.has(part));
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
      return true;
    }
    console.error(`[KimFlow] Hotkey could not be registered: ${normalized}`);
    if (previous) {
      globalShortcut.register(previous, () => {
        if (onHotkeyPressed) onHotkeyPressed();
      });
      activeHotkey = previous;
      configuredHotkey = previousConfigured;
    }
    return false;
  } catch (error) {
    console.error('[KimFlow] Failed to register hotkey:', error);
    if (previous) {
      globalShortcut.register(previous, () => {
        if (onHotkeyPressed) onHotkeyPressed();
      });
      activeHotkey = previous;
      configuredHotkey = previousConfigured;
    }
    return false;
  }
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

module.exports = { registerHotkeys, unregisterHotkeys, setHotkeyCallbacks, normalizeHotkey, isValidHotkey, getActiveHotkey };
