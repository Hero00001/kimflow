const { globalShortcut } = require('electron');

let onHotkeyPressed = null;
let activeHotkey = null;

function normalizeHotkey(hotkey) {
  const aliases = {
    CmdOrCtrl: process.platform === 'darwin' ? 'Command' : 'Control',
    CommandOrControl: process.platform === 'darwin' ? 'Command' : 'Control',
    Cmd: process.platform === 'darwin' ? 'Command' : 'Control',
    Ctrl: 'Control',
    Command: 'Command',
    Control: 'Control',
  };

  return String(hotkey || '')
    .split('+')
    .map((part) => aliases[part] || part)
    .join('+');
}

// A hotkey is a bare key ("1", "F5", "Space") or modifier(s)
// plus a key ("Ctrl+Shift+Space"). Every part before the final
// key must be a modifier; a lone modifier is not a hotkey.
const MODIFIERS = new Set(['Control', 'Command', 'Alt', 'Shift', 'Super', 'Ctrl', 'Cmd', 'CmdOrCtrl', 'CommandOrControl']);
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
  unregisterHotkeys();

  try {
    const registered = globalShortcut.register(normalized, () => {
      if (onHotkeyPressed) onHotkeyPressed();
    });
    if (registered) {
      activeHotkey = normalized;
      return true;
    }
    console.error(`[KimFlow] Hotkey could not be registered: ${normalized}`);
    if (previous) {
      globalShortcut.register(previous, () => {
        if (onHotkeyPressed) onHotkeyPressed();
      });
      activeHotkey = previous;
    }
    return false;
  } catch (error) {
    console.error('[KimFlow] Failed to register hotkey:', error);
    if (previous) {
      globalShortcut.register(previous, () => {
        if (onHotkeyPressed) onHotkeyPressed();
      });
      activeHotkey = previous;
    }
    return false;
  }
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
  activeHotkey = null;
}

function setHotkeyCallbacks(pressed) {
  // Note: no release callback exists on purpose. OS global shortcuts only
  // fire on press — push-to-talk release is handled renderer-side, which
  // safely toggles instead (see handleTrigger in src/recording.ts).
  onHotkeyPressed = pressed;
}

module.exports = { registerHotkeys, unregisterHotkeys, setHotkeyCallbacks, normalizeHotkey, isValidHotkey };
