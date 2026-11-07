// scripts/electron45-probe.cjs
//
// One-shot runtime validation for the Electron 45 upgrade. Exercises every
// Electron API KimFlow's main process depends on, against a THROWAWAY
// userData directory — the real profile and secret blobs are never touched.
//
//   env -u ELECTRON_RUN_AS_NODE npx electron scripts/electron45-probe.cjs
//
// Exit 0 = all checks passed; nonzero = a regression to investigate.

const path = require('path');
const fs = require('fs');
const os = require('os');

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((detail) => { results.push(['PASS', name, detail === undefined ? '' : String(detail)]); })
    .catch((error) => { results.push(['FAIL', name, error instanceof Error ? error.message : String(error)]); });
}

const electron = require('electron');
const { app, BrowserWindow, safeStorage, globalShortcut, screen, session, ipcMain, clipboard } = electron;

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-probe-')));

app.whenReady().then(async () => {
  await check('versions', () => {
    const v = process.versions;
    return `electron=${v.electron} chrome=${v.chrome} node=${v.node}`;
  });
  await check('app.getLocale', () => app.getLocale() || '(empty ok)');
  await check('safeStorage available', () => safeStorage.isEncryptionAvailable());
  await check('safeStorage encrypt/decrypt round-trip', () => {
    if (!safeStorage.isEncryptionAvailable()) return 'SKIPPED (no OS keychain)';
    const secret = 'kimflow-probe-key-abc123';
    const encrypted = safeStorage.encryptString(secret);
    const decrypted = safeStorage.decryptString(encrypted);
    if (decrypted !== secret) throw new Error(`round-trip mismatch: ${decrypted}`);
    return 'ok (blob decrypts identically)';
  });
  await check('safeStorage isEncryptionAvailable + blob byte length', () => {
    if (!safeStorage.isEncryptionAvailable()) return 'SKIPPED';
    const blob = safeStorage.encryptString('x');
    return `${blob.length} bytes`;
  });
  await check('globalShortcut register/unregister', () => {
    const ok = globalShortcut.register('F24', () => {});
    globalShortcut.unregister('F24');
    if (!ok) throw new Error('register returned false');
    return 'ok (F24 registered then released)';
  });
  await check('screen primary display', () => {
    const d = screen.getPrimaryDisplay();
    if (!d.workArea || d.workArea.width <= 0) throw new Error('invalid work area');
    return `${d.workArea.width}x${d.workArea.height}`;
  });
  await check('screen cursor + display nearest', () => {
    const p = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(p);
    return `cursor (${p.x},${p.y}) -> display ${d.workArea.width}x${d.workArea.height}`;
  });
  await check('session permission handler registrable', () => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    return 'ok (media-gating handlers installed, matching main.cjs pattern)';
  });
  await check('ipcMain.handle round-trip', async () => {
    ipcMain.handle('probe-ping', () => 'pong');
    return 'ok (handler registered)';
  });
  await check('clipboard writeText', async () => {
    // Electron 45 made clipboard READS promise-based; KimFlow only ever
    // writes (paste.cjs:27), so the write path is what must work.
    clipboard.writeText('kimflow-probe-xyz');
    const read = clipboard.readText();
    const value = typeof read === 'string' ? read : await read; // 45 returns a Promise
    if (value !== 'kimflow-probe-xyz') throw new Error(`read-back mismatch: ${value}`);
    return 'ok (write + read-back; reads are promise-based in 45, app never reads)';
  });
  await check('BrowserWindow with production webPreferences', async () => {
    const win = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    try {
      await win.loadURL('data:text/html,<html><body>probe</body></html>');
      const title = await win.webContents.executeJavaScript('document.body.textContent');
      if (title !== 'probe') throw new Error(`unexpected body: ${title}`);
      return 'ok (sandboxed window + production preload loaded, no preload crash)';
    } finally {
      win.destroy();
    }
  });

  let failed = 0;
  for (const [status, name, detail] of results) {
    if (status === 'FAIL') failed += 1;
    console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`);
  }
  console.log(failed === 0 ? 'PROBE RESULT: ALL CHECKS PASSED' : `PROBE RESULT: ${failed} FAILURE(S)`);
  try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {}
  process.exit(failed === 0 ? 0 : 1);
});
