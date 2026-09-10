const test = require('node:test');
const assert = require('node:assert');
const { shouldDropResult } = require('../backend/recorder.cjs');
test('drops late transcription after cancel', () => {
  assert.equal(shouldDropResult(1, 2), true);
  assert.equal(shouldDropResult(2, 2), false);
});
