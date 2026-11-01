// scripts/widget-shot.cjs
//
// Standalone screenshot harness for the flow-bar widget. NOT part of the app,
// NOT wired into package.json, and never run by the test suite. Run it by hand
// on a machine with a display:
//
//   npx electron scripts/widget-shot.cjs
//
// It writes .scratch/flow-bar-widget/shots/{idle,listening,paused,processing}.png
// and logs renderer console messages plus the ready sentinel, so a CSP or
// path failure shows up as a log line instead of a silently empty capsule.
//
// package.json has "type": "module", hence the .cjs extension.
const { app, BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const { createWidgetWindow, destroyWidgetWindow } = require('../backend/widget-window.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, '.scratch', 'flow-bar-widget', 'shots');
const STATES = ['idle', 'listening', 'paused', 'processing'];
const SETTLE_MS = 400;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Electron changed the `console-message` signature across major versions. */
function logConsoleMessage(event, level, message, line, sourceId) {
  const details = event && typeof event === 'object' && event.message !== undefined ? event : null;
  if (details) {
    console.log(`[widget console] level=${details.level} ${details.message} (${details.sourceId}:${details.lineNumber})`);
    return;
  }
  console.log(`[widget console] level=${level} ${message} (${sourceId}:${line})`);
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = createWidgetWindow({
    BrowserWindow,
    screen,
    preloadPath: path.join(ROOT, 'preload.cjs'),
    iconPath: path.join(ROOT, 'app icon', 'icon.ico'),
    getState: () => 'ready',
  });

  win.webContents.on('console-message', logConsoleMessage);

  const loaded = new Promise((resolve) => {
    if (!win.webContents.isLoading()) {
      resolve();
      return;
    }
    win.webContents.once('did-finish-load', resolve);
    setTimeout(resolve, 5000);
  });
  await loaded;
  await wait(200);

  const ready = await win.webContents.executeJavaScript('window.__kimflowWidgetReady === true');
  console.log(`[widget] __kimflowWidgetReady = ${ready}`);
  if (ready !== true) {
    console.log('[widget] the renderer script did not run: check CSP, relative paths and console output above');
  }

  for (const state of STATES) {
    await win.webContents.executeJavaScript(`window.__kimflowWidgetSetState(${JSON.stringify(state)});`);
    await wait(SETTLE_MS);

    const box = await win.webContents.executeJavaScript(
      '(() => { const r = document.getElementById("pill").getBoundingClientRect(); return { width: r.width, height: r.height }; })()',
    );
    console.log(`[widget] ${state} capsule ${box.width}x${box.height}`);

    const image = await win.webContents.capturePage();
    const file = path.join(OUT_DIR, `${state}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log(`[widget] wrote ${path.relative(ROOT, file)}`);
  }

  destroyWidgetWindow();
  app.quit();
}).catch((error) => {
  console.error('[widget-shot] failed:', error);
  destroyWidgetWindow();
  app.exit(1);
});
