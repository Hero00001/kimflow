const { execFile } = require('child_process');

// The paste command is a child process. It must not be able to wedge the
// recording pipeline: macOS may show an Accessibility permission dialog that
// never gets answered, and a blocked PowerShell may hang indefinitely.
const PASTE_TIMEOUT_MS = 5000;

/**
 * Copy text to the clipboard and paste it into the focused application.
 *
 * Resolves to `{ ok, error }` describing what ACTUALLY happened. The paste
 * command runs in a child process, so its failure is only known once the
 * child exits — reporting success before that would hide every failure
 * behind an unreachable error message.
 *
 * @param {string} text
 * @param {{run?: Function, writeClipboard?: Function}} [deps] injection seam
 *   for the test suite; both default to the real implementations.
 */
async function pasteText(text, deps = {}) {
  if (!text) return { ok: true, error: null };

  const writeClipboard = deps.writeClipboard || ((value) => {
    require('electron').clipboard.writeText(value);
  });
  const run = deps.run || defaultRun;

  try {
    writeClipboard(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }

  try {
    await run();
    return { ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[KimFlow] Paste failed:', message);
    return { ok: false, error: message };
  }
}

/**
 * Run the platform's paste command.
 *
 * macOS needs Accessibility permission for System Events, and Windows may
 * have PowerShell blocked by policy — both surface here as a rejection.
 */
function defaultRun() {
  return new Promise((resolve, reject) => {
    const options = { timeout: PASTE_TIMEOUT_MS };
    if (process.platform === 'darwin') {
      execFile(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "v" using command down'],
        options,
        (error) => (error ? reject(error) : resolve()),
      );
      return;
    }

    if (process.platform === 'win32') {
      // WScript.Shell is available on supported Windows installations and
      // avoids a native Node module that must be rebuilt for every Electron
      // version.
      const script = '$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys("^v")';
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], options, (error) => (
        error ? reject(error) : resolve()
      ));
      return;
    }

    execFile('xdotool', ['key', 'ctrl+v'], options, (error) => (error ? reject(error) : resolve()));
  });
}

module.exports = { pasteText, PASTE_TIMEOUT_MS };
