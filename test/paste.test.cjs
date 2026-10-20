// test/paste.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { pasteText } = require('../backend/paste.cjs');

test('pasteText returns a result object', async () => {
  // The clipboard and the paste command are injected: this suite runs
  // outside Electron, where neither is available.
  const r = await pasteText('hello', {
    writeClipboard: () => {},
    run: () => Promise.resolve(),
  });
  assert.equal(typeof r.ok, 'boolean');
});
