// test/engine-hash.test.cjs
//
// Regression test for the MEDIUM defect: hashing a 273 MB engine download
// blocked the Electron main thread.
//
// `sha256File` did `hash.update(fs.readFileSync(filePath))` — the whole
// NVIDIA zip was read into memory synchronously on the main process thread,
// freezing the window, the overlay and the global hotkey for the duration.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256File } = require('../backend/engine-download.cjs');

test('sha256File hashes a file to the expected digest', async () => {
  const file = path.join(os.tmpdir(), `kimflow-hash-${crypto.randomUUID()}.bin`);
  const payload = Buffer.alloc(64 * 1024, 7);
  fs.writeFileSync(file, payload);
  try {
    const digest = await sha256File(file);
    assert.equal(digest, crypto.createHash('sha256').update(payload).digest('hex'));
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('sha256File rejects when the file cannot be read', async () => {
  await assert.rejects(
    () => sha256File(path.join(os.tmpdir(), `kimflow-missing-${crypto.randomUUID()}.bin`)),
  );
});
