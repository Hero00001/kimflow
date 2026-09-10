// test/paste.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { pasteText } = require('../backend/paste.cjs');
test('pasteText returns result object', () => {
  const r = pasteText('hello');
  assert.equal(typeof r.ok, 'boolean');
});
