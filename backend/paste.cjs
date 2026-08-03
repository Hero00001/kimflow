const { clipboard } = require('electron');
const { execFile } = require('child_process');

function pasteText(text) {
  if (!text) return;
  clipboard.writeText(text);

  if (process.platform === 'darwin') {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], (error) => {
      if (error) console.error('[KimFlow] Paste failed:', error.message);
    });
    return;
  }

  if (process.platform === 'win32') {
    // WScript.Shell is available on supported Windows installations and avoids
    // a native Node module that must be rebuilt for every Electron version.
    const script = '$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys("^v")';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (error) => {
      if (error) console.error('[KimFlow] Paste failed:', error.message);
    });
    return;
  }

  execFile('xdotool', ['key', 'ctrl+v'], (error) => {
    if (error) console.error('[KimFlow] Paste failed:', error.message);
  });
}

module.exports = { pasteText };
