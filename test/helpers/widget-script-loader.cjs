'use strict';
// Loads a classic (non-module) script from src/widget/ inside node:vm with a
// fake `window`, so the widget's browser code can be unit tested without a
// browser, a DOM or Electron.
//
// The widget scripts are deliberately plain `<script>` files (no bundler, no
// ESM) so that `loadFile` resolves them identically in dev, `npm start` and the
// packaged asar. `require()` cannot load them under `"type": "module"`, hence
// the sandbox.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Evaluate one widget script in a fresh sandbox.
 *
 * @param {string} relativePath repo-relative path, e.g. 'src/widget/widget-pure.js'
 * @param {object} [globals] extra globals the script may need (document, performance, ...)
 * @returns {object} the fake `window`, including whatever the script attached to it
 */
function loadWidgetScript(relativePath, globals = {}) {
  const file = path.join(ROOT, relativePath);
  const code = fs.readFileSync(file, 'utf8');
  const window = {};
  const sandbox = { window, console, ...globals };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: relativePath });
  return window;
}

module.exports = { loadWidgetScript, ROOT };
