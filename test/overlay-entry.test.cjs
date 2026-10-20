// test/overlay-entry.test.cjs
//
// Regression test for the MEDIUM-HIGH defect: the floating overlay was
// completely inert in the documented dev workflow.
//
// `getOverlayEntry()` always returned a `file://` URL. On a fresh clone
// `dist/` does not exist, so it fell back to the source `src/overlay.html`,
// whose `<script type="module" src="/src/overlay.ts">` resolves under
// `file://` to the filesystem root — a path that does not exist. The overlay
// rendered its static HTML with no JavaScript: every button dead and the
// state text frozen on "Ready".
//
// The main window was unaffected because `getRendererEntry()` DOES use the
// dev server.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadMain } = require('./helpers/electron-main-harness.cjs');

/**
 * Load main.cjs with a stubbed Electron and report what the overlay window
 * was asked to load.
 */
async function overlayEntry(t, { dev }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-overlay-'));
  const previousArgv = process.argv.slice();
  const previousHost = process.env.ELECTRON_DEV_HOST;
  t.after(() => {
    process.argv = previousArgv;
    if (previousHost === undefined) delete process.env.ELECTRON_DEV_HOST;
    else process.env.ELECTRON_DEV_HOST = previousHost;
  });
  if (dev) {
    process.argv = previousArgv.concat('--dev');
    process.env.ELECTRON_DEV_HOST = 'localhost';
  } else {
    process.argv = previousArgv.filter((arg) => arg !== '--dev');
    delete process.env.ELECTRON_DEV_HOST;
  }
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  const overlay = harness.instances[1];
  return { url: overlay.loadedUrl, file: overlay.loadedFile };
}

test('in development the overlay is served by the dev server', async (t) => {
  const { url, file } = await overlayEntry(t, { dev: true });
  assert.equal(file, null, 'the overlay must not be loaded from disk in development');
  assert.equal(url, 'http://localhost:1420/src/overlay.html');
});

test('the main window is still served by the dev server in development', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kimflow-overlay-'));
  const previousArgv = process.argv.slice();
  t.after(() => {
    process.argv = previousArgv;
    delete process.env.ELECTRON_DEV_HOST;
  });
  process.argv = previousArgv.concat('--dev');
  process.env.ELECTRON_DEV_HOST = 'localhost';
  const harness = await loadMain({ locale: 'en-US', home });
  t.after(() => harness.restore());
  assert.equal(harness.instances[0].loadedUrl, 'http://localhost:1420');
});

test('outside development the overlay is loaded from disk', async (t) => {
  const { url, file } = await overlayEntry(t, { dev: false });
  assert.equal(url, null);
  assert.ok(file.endsWith('overlay.html'), `expected an overlay.html file, got ${file}`);
});

test('the source overlay cannot work over file://', () => {
  // The source overlay's script tag is an absolute path, which resolves
  // outside the project under file:// — the reason the dev server must
  // serve it.
  const source = fs.readFileSync('src/overlay.html', 'utf8');
  assert.match(source, /<script type="module" src="\/src\/overlay\.ts">/);
});
