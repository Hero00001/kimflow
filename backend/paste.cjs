const { execFile } = require('child_process');
const pasteHelper = require('./paste-helper.cjs');

// The paste command is a child process. It must not be able to wedge the
// recording pipeline: macOS may show an Accessibility permission dialog that
// never gets answered, and a blocked PowerShell may hang indefinitely.
const PASTE_TIMEOUT_MS = 5000;

/**
 * Copy text to the clipboard and paste it into the focused application.
 *
 * Resolves to `{ ok, error }` describing what ACTUALLY happened. The paste
 * runs in a child process, so its failure is only known once the child
 * confirms — reporting success before that would hide every failure
 * behind an unreachable error message.
 *
 * @param {string} text
 * @param {{run?: Function, writeClipboard?: Function, pasteViaHelper?: Function}} [deps]
 *   injection seam for the test suite; all default to the real
 *   implementations. `pasteViaHelper` replaces the persistent SendInput
 *   helper used on the Windows path.
 */
async function pasteText(text, deps = {}) {
  if (!text) return { ok: true, error: null };

  const writeClipboard = deps.writeClipboard || ((value) => {
    require('electron').clipboard.writeText(value);
  });
  const run = deps.run || (() => defaultRun(deps));

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
 *
 * @param {{pasteViaHelper?: Function}} [deps]
 */
function defaultRun(deps = {}) {
  const options = { timeout: PASTE_TIMEOUT_MS };

  if (process.platform === 'win32') {
    return runWindowsPaste({ pasteViaHelper: deps.pasteViaHelper });
  }

  return new Promise((resolve, reject) => {
    if (process.platform === 'darwin') {
      execFile(
        'osascript',
        ['-e', 'tell application "System Events" to keystroke "v" using command down'],
        options,
        (error) => (error ? reject(error) : resolve()),
      );
      return;
    }

    execFile('xdotool', ['key', 'ctrl+v'], options, (error) => (error ? reject(error) : resolve()));
  });
}

/**
 * The legacy per-paste injection: a fresh PowerShell running
 * WScript.Shell.SendKeys. Slow (~500 ms of interpreter startup per paste)
 * and flaky with some Chromium/DirectUI and raw-input apps, but it survives
 * environments where Add-Type is blocked by AMSI or corporate policy — which
 * is exactly why it stays as the second rung of the ladder.
 */
function runWindowsSendKeys() {
  return new Promise((resolve, reject) => {
    const script = '$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys("^v")';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: PASTE_TIMEOUT_MS },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

/**
 * Windows fallback ladder:
 *   1. the persistent SendInput helper (fast: one keystroke round trip);
 *   2. the legacy per-paste SendKeys injection (unchanged behaviour);
 * only if that also fails does the error reach the caller, where the
 * recorder turns it into the "paste failed, text copied to clipboard"
 * fallback toast.
 *
 * Note: an ELEVATED (run-as-administrator) target window silently ignores
 * injected input from a non-elevated process (Windows UIPI) on BOTH rungs —
 * no code can fix that; the user must run KimFlow elevated too.
 *
 * @param {{pasteViaHelper?: Function, runSendKeys?: Function}} [deps]
 *   injection seam for the test suite.
 */
async function runWindowsPaste(deps = {}) {
  const viaHelper = deps.pasteViaHelper || pasteHelper.pasteViaHelper;
  const viaSendKeys = deps.runSendKeys || runWindowsSendKeys;

  try {
    await viaHelper();
    return;
  } catch (error) {
    // Typed, logged-once reason: the helper can fail to spawn, fail to
    // compile its C# type (AMSI / corporate policy), time out, or report
    // PASTE_FAIL. Every one of those falls through to SendKeys.
    const message = error instanceof Error ? error.message : String(error);
    console.error('[KimFlow] SendInput paste helper unavailable, falling back to SendKeys:', message);
  }
  return viaSendKeys();
}

module.exports = { pasteText, PASTE_TIMEOUT_MS, runWindowsPaste, runWindowsSendKeys };
