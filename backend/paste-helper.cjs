'use strict';
// Persistent paste helper for Windows.
//
// Spawning a fresh PowerShell per paste costs ~500 ms (bare interpreter
// startup is ~350 ms). During that dead gap the user — mid-conversation in a
// chat app — may click elsewhere, so the Ctrl+V lands nowhere or into the
// wrong target. This module instead keeps ONE long-lived PowerShell child
// alive whose C# `SendInput` P/Invoke type is compiled exactly once; each
// paste is then a single stdin/stdout round trip.
//
// Protocol (stdin lines -> one stdout line per command):
//   (startup)        helper prints `READY` once Add-Type succeeded, or
//                    `COMPILE_FAIL <reason>` and exits (AMSI / corporate
//                    policy can block Add-Type — that is why the fallback
//                    ladder in paste.cjs exists).
//   `paste`   ->     `PASTE_OK` | `PASTE_FAIL <reason>`
//   `quit`    ->     helper exits
//   EOF on stdin ->  helper exits
//
// The child is spawned lazily on first use (never at startup) and killed from
// main.cjs's `will-quit` handler via `shutdownPasteHelper()`.

const { spawn } = require('child_process');
const readline = require('readline');

// Same bound as paste.cjs's PASTE_TIMEOUT_MS: a paste (or the one-time
// compile) must never wedge the recording pipeline.
const PASTE_HELPER_TIMEOUT_MS = 5000;

// PowerShell script run by the persistent helper. Compiled to C# once, then
// loops on stdin. Sent via `-EncodedCommand` so no character of the script
// can be mangled by Windows command-line quoting.
const HELPER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$src = @'",
  'using System;',
  'using System.Runtime.InteropServices;',
  'public static class KimFlowSendInput {',
  '  [StructLayout(LayoutKind.Sequential)]',
  '  public struct MOUSEINPUT {',
  '    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;',
  '  }',
  '  [StructLayout(LayoutKind.Sequential)]',
  '  public struct KEYBDINPUT {',
  '    public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo;',
  '  }',
  '  // Explicit overlay so INPUT has the full (mouse-sized) union extent the',
  '  // real win32 INPUT has on both x64 and x86; SendInput validates cbSize.',
  '  [StructLayout(LayoutKind.Explicit)]',
  '  public struct INPUTUNION {',
  '    [FieldOffset(0)] public MOUSEINPUT mi;',
  '    [FieldOffset(0)] public KEYBDINPUT ki;',
  '  }',
  '  [StructLayout(LayoutKind.Sequential)]',
  '  public struct INPUT {',
  '    public uint type; public INPUTUNION u;',
  '  }',
  '  [DllImport("user32.dll", SetLastError = true)]',
  '  public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);',
  '  public static uint SendCtrlV() {',
  '    const uint KEYEVENTF_KEYUP = 0x0002;',
  '    INPUT[] events = new INPUT[4];',
  '    // VK_CONTROL 0x11 down, VK_V 0x56 down, V up, Ctrl up.',
  '    events[0].type = 1; events[0].u.ki.wVk = 0x11;',
  '    events[1].type = 1; events[1].u.ki.wVk = 0x56;',
  '    events[2].type = 1; events[2].u.ki.wVk = 0x56; events[2].u.ki.dwFlags = KEYEVENTF_KEYUP;',
  '    events[3].type = 1; events[3].u.ki.wVk = 0x11; events[3].u.ki.dwFlags = KEYEVENTF_KEYUP;',
  '    return SendInput(4, events, Marshal.SizeOf(typeof(INPUT)));',
  '  }',
  '}',
  "'@",
  'try {',
  '  Add-Type -TypeDefinition $src | Out-Null',
  '} catch {',
  "  [Console]::Out.WriteLine('COMPILE_FAIL ' + $_.Exception.Message)",
  '  [Console]::Out.Flush()',
  '  exit 1',
  '}',
  "  [Console]::Out.WriteLine('READY')",
  '  [Console]::Out.Flush()',
  '$stdin = [Console]::In',
  'while ($true) {',
  '  $line = $stdin.ReadLine()',
  '  if ($null -eq $line) { break }',
  "  if ($line -eq 'quit') { break }",
  "  if ($line -eq 'paste') {",
  '    try {',
  '      $count = [KimFlowSendInput]::SendCtrlV()',
  '      if ($count -eq 4) {',
  "        [Console]::Out.WriteLine('PASTE_OK')",
  '      } else {',
  "        [Console]::Out.WriteLine('PASTE_FAIL SendInput injected ' + $count + ' of 4 events')",
  '      }',
  '    } catch {',
  "      [Console]::Out.WriteLine('PASTE_FAIL ' + $_.Exception.Message)",
  '    }',
  '    [Console]::Out.Flush()',
  '  }',
  '}',
].join('\n');

// The one live helper: { child, pending, startupTimer, stderr }.
let helper = null;

function isWindows() {
  return process.platform === 'win32';
}

/**
 * Reject (or resolve) the in-flight paste of a helper, if any.
 */
function failPending(state, message) {
  if (!state.pending) return;
  const pending = state.pending;
  state.pending = null;
  clearTimeout(pending.timer);
  pending.reject(new Error(message));
}

/**
 * Handle one stdout line from the helper.
 */
function handleHelperLine(state, line, onReady) {
  if (line === 'READY') {
    if (state.startupTimer) {
      clearTimeout(state.startupTimer);
      state.startupTimer = null;
    }
    onReady();
    return;
  }
  if (line === 'PASTE_OK') {
    const pending = state.pending;
    if (pending) {
      state.pending = null;
      clearTimeout(pending.timer);
      pending.resolve();
    }
    return;
  }
  if (line.startsWith('PASTE_FAIL')) {
    const reason = line.slice('PASTE_FAIL'.length).trim() || 'SendInput reported a failure';
    failPending(state, reason);
    return;
  }
  if (line.startsWith('COMPILE_FAIL')) {
    state.compileError = line.slice('COMPILE_FAIL'.length).trim() || 'Add-Type was blocked';
    return;
  }
  // Unknown line: diagnostics from PowerShell noise. Logged once, never
  // treated as protocol.
  console.error(`[KimFlow] Paste helper stdout: ${line}`);
}

/**
 * Spawn the persistent PowerShell helper and wait for `READY`.
 *
 * @param {{spawn?: Function, startupTimeoutMs?: number}} [deps] injection seam
 *   for the test suite; `spawn` defaults to child_process.spawn.
 * @returns {Promise<object>} the live helper state
 */
function ensureHelper(deps = {}) {
  if (!isWindows()) {
    return Promise.reject(new Error('Paste helper is only available on Windows'));
  }
  if (helper) return Promise.resolve(helper);

  const spawnImpl = deps.spawn || spawn;
  const startupTimeoutMs = deps.startupTimeoutMs || PASTE_HELPER_TIMEOUT_MS;
  const encoded = Buffer.from(HELPER_SCRIPT, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    let settled = false;
    let child;
    try {
      child = spawnImpl(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
      );
    } catch (error) {
      reject(error);
      return;
    }

    const state = { child, pending: null, startupTimer: null, compileError: null, stderr: '' };
    // EPIPE from a dying child's stdin is expected; it is surfaced through
    // the pending paste below, never through an uncaught exception.
    child.stdin.on('error', () => {});
    child.stderr.on('data', (chunk) => {
      // Keep the tail only: PowerShell banner noise can be large, the
      // interesting part (the actual error) is last.
      state.stderr = `${state.stderr}${chunk}`.slice(-4000);
    });

    const onExit = (code) => {
      helper = null;
      if (state.startupTimer) {
        clearTimeout(state.startupTimer);
        state.startupTimer = null;
      }
      const tail = state.compileError
        || (state.stderr ? state.stderr.trim().split('\n').pop() : '');
      failPending(state, `paste helper exited unexpectedly (code ${code})${tail ? `: ${tail}` : ''}`);
      if (!settled) {
        settled = true;
        reject(new Error(
          state.compileError
            || `paste helper exited during startup (code ${code})${tail ? `: ${tail}` : ''}`,
        ));
      }
    };
    child.on('error', (error) => {
      helper = null;
      failPending(state, `paste helper process error: ${error.message}`);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('exit', onExit);

    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      handleHelperLine(state, line, () => {
        if (settled) return;
        settled = true;
        helper = state;
        resolve(state);
      });
    });

    state.startupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      helper = null;
      try { child.kill(); } catch { /* best effort */ }
      reject(new Error(`paste helper did not become ready within ${startupTimeoutMs}ms`));
    }, startupTimeoutMs);
  });
}

/**
 * Send one `paste` command to a live helper and await its confirmation.
 */
function sendPaste(state, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!state || !state.child || state.child.exitCode !== null) {
      reject(new Error('paste helper is not running'));
      return;
    }
    if (state.pending) {
      reject(new Error('another paste is still in progress'));
      return;
    }
    const timer = setTimeout(() => {
      state.pending = null;
      // The helper missed its deadline: kill it so the NEXT paste respawns
      // a clean process instead of talking into a wedged one.
      try { state.child.kill(); } catch { /* best effort */ }
      reject(new Error(`paste helper timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    state.pending = { resolve, reject, timer };
    state.child.stdin.write('paste\n', (error) => {
      if (error) failPending(state, `could not reach the paste helper: ${error.message}`);
    });
  });
}

/**
 * Paste via the persistent SendInput helper.
 *
 * Resolves when the helper confirmed `PASTE_OK`; rejects with an explicit
 * reason otherwise (spawn failure, compile failure, timeout, PASTE_FAIL).
 * The caller — paste.cjs's fallback ladder — decides what to do next.
 *
 * @param {{spawn?: Function, timeoutMs?: number, startupTimeoutMs?: number}} [deps]
 */
async function pasteViaHelper(deps = {}) {
  const state = await ensureHelper(deps);
  await sendPaste(state, deps.timeoutMs || PASTE_HELPER_TIMEOUT_MS);
}

/**
 * Kill the persistent helper. Called from main.cjs's `will-quit` handler.
 *
 * Asks the helper to exit via `quit` first and force-kills it shortly after,
 * so nothing outlives the app even if the interpreter is wedged.
 */
function shutdownPasteHelper() {
  const state = helper;
  helper = null;
  if (!state) return;
  failPending(state, 'KimFlow is shutting down');
  if (state.startupTimer) {
    clearTimeout(state.startupTimer);
    state.startupTimer = null;
  }
  try { state.child.stdin.write('quit\n'); } catch { /* stdin already gone */ }
  try { state.child.stdin.end(); } catch { /* stdin already gone */ }
  const child = state.child;
  const forceKill = setTimeout(() => {
    try { child.kill(); } catch { /* best effort */ }
  }, 500);
  if (typeof forceKill.unref === 'function') forceKill.unref();
}

module.exports = {
  pasteViaHelper,
  shutdownPasteHelper,
  PASTE_HELPER_TIMEOUT_MS,
  // Exposed for the test suite only: run the protocol against a fake child.
  ensureHelper,
  sendPaste,
  HELPER_SCRIPT,
};
