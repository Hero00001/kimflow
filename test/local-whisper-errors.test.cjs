const test = require('node:test');
const assert = require('node:assert');
test('whisper missing-binary message is friendly single-line', async () => {
  const lw = require('../backend/engines/local-whisper.cjs');
  try { await lw.transcribe('small', 'nope.wav', 'auto', '/definitely/missing/whisper-cli', null, 'thorough', []); assert.fail('should throw'); }
  catch (e) { assert.ok(!/stderr|exit code/i.test(e.message), e.message); assert.ok(/not found|Select Binary/i.test(e.message), e.message); }
});
