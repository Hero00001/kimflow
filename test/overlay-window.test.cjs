const test = require('node:test');
const assert = require('node:assert');
const { buildOverlayWindowOptions } = require('../backend/overlay-window.cjs');

test('overlay window is shadowless and fully transparent', () => {
  const options = buildOverlayWindowOptions({ preloadPath: 'preload.cjs', iconPath: 'icon.png' });
  assert.equal(options.frame, false);
  assert.equal(options.transparent, true);
  assert.equal(options.hasShadow, false);
  assert.equal(options.backgroundColor, '#00000000');
});
