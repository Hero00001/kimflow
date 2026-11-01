// test/widget-entry.test.cjs
//
// The floating UI must load `src/widget/widget.html` from disk (never a URL)
// when the flow-bar widget is enabled — including in the `--dev` workflow,
// where the legacy overlay was served by the Vite dev server.
//
// The widget is a plain static file, so `loadFile` resolves identically in dev,
// `npm start` and the packaged asar. That structurally avoids the
// file://-inert bug test/overlay-entry.test.cjs guards against.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

const WIDGET_FILE = path.join('src', 'widget', 'widget.html');

/**
 * Load main.cjs under the harness and return the floating window (instance 1).
 *
 * @param {object} t node:test context
 * @param {{dev?: boolean, settings?: object, flowbarEnv?: string}} options
 */
async function boot(t, { dev = false, settings = null, flowbarEnv } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-widget-entry-'));
  const previousArgv = process.argv.slice();
  const previousHost = process.env.ELECTRON_DEV_HOST;
  const previousFlowBar = process.env.KIMFLOW_FLOWBAR;

  t.after(() => {
    process.argv = previousArgv;
    if (previousHost === undefined) delete process.env.ELECTRON_DEV_HOST;
    else process.env.ELECTRON_DEV_HOST = previousHost;
    if (previousFlowBar === undefined) delete process.env.KIMFLOW_FLOWBAR;
    else process.env.KIMFLOW_FLOWBAR = previousFlowBar;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  if (dev) {
    process.argv = previousArgv.concat('--dev');
    process.env.ELECTRON_DEV_HOST = 'localhost';
  } else {
    process.argv = previousArgv.filter((arg) => arg !== '--dev');
    delete process.env.ELECTRON_DEV_HOST;
  }
  if (flowbarEnv === undefined) delete process.env.KIMFLOW_FLOWBAR;
  else process.env.KIMFLOW_FLOWBAR = flowbarEnv;

  const harness = await loadMain({ locale: 'en-US', home, settings });
  t.after(() => harness.restore());
  return harness.instances[1];
}

test('with the flag on the widget is loaded from disk in development', async (t) => {
  const floating = await boot(t, { dev: true });
  assert.equal(floating.loadedUrl, null, 'the widget must never be served by the dev server');
  assert.ok(floating.loadedFile.endsWith(WIDGET_FILE), `expected the widget file, got ${floating.loadedFile}`);
});

test('with the flag on the widget is loaded from disk in production', async (t) => {
  const floating = await boot(t, { dev: false });
  assert.equal(floating.loadedUrl, null);
  assert.ok(floating.loadedFile.endsWith(WIDGET_FILE), `expected the widget file, got ${floating.loadedFile}`);
});

test('the widget window is shown without stealing focus', async (t) => {
  const floating = await boot(t, { dev: false });
  assert.equal(floating.options.focusable, false);
  assert.equal(floating.options.show, false);
  assert.equal(floating.shownInactive, true);
});

test('the main window is still served by the dev server when the widget is on', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-widget-entry-'));
  const previousArgv = process.argv.slice();
  t.after(() => {
    process.argv = previousArgv;
    delete process.env.ELECTRON_DEV_HOST;
    try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
  process.argv = previousArgv.concat('--dev');
  process.env.ELECTRON_DEV_HOST = 'localhost';
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  assert.equal(harness.instances[0].loadedUrl, 'http://localhost:1420');
});

test('with the flag off the legacy overlay is used, unchanged', async (t) => {
  const dev = await boot(t, { dev: true, settings: { useFlowBarWidget: false } });
  assert.equal(dev.loadedFile, null);
  assert.equal(dev.loadedUrl, 'http://localhost:1420/src/overlay.html');

  const prod = await boot(t, { dev: false, settings: { useFlowBarWidget: false } });
  assert.equal(prod.loadedUrl, null);
  assert.ok(prod.loadedFile.endsWith('overlay.html'), `expected overlay.html, got ${prod.loadedFile}`);
});

test('KIMFLOW_FLOWBAR=0 forces the legacy overlay for one launch', async (t) => {
  const floating = await boot(t, { dev: false, flowbarEnv: '0' });
  assert.equal(floating.loadedUrl, null);
  assert.ok(floating.loadedFile.endsWith('overlay.html'), `expected overlay.html, got ${floating.loadedFile}`);
});

test('the widget renderer files exist where the main process loads them from', () => {
  for (const file of ['widget.html', 'widget.css', 'widget.js', 'widget-pure.js']) {
    assert.ok(fs.existsSync(path.join('src', 'widget', file)), `missing src/widget/${file}`);
  }
});
