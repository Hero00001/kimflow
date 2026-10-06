// test/audio-size.test.cjs
//
// The stop-recording IPC handler must measure audio BEFORE copying it into
// a Buffer, so absurd payloads are rejected instead of OOMing the process.
const test = require('node:test');
const assert = require('node:assert');

const { audioByteLength } = require('../backend/audio.cjs');

test('measures Buffer, ArrayBuffer and typed-array views', () => {
  assert.equal(audioByteLength(Buffer.alloc(10)), 10);
  assert.equal(audioByteLength(new ArrayBuffer(12)), 12);
  const view = new Uint8Array(new ArrayBuffer(16), 4, 8);
  assert.equal(audioByteLength(view), 8);
});

test('returns 0 for unknown shapes', () => {
  assert.equal(audioByteLength(null), 0);
  assert.equal(audioByteLength(undefined), 0);
  assert.equal(audioByteLength('nope'), 0);
  assert.equal(audioByteLength(42), 0);
});
