const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MAX_RECORDING_MS, scheduleAutoStopTimer, clearAutoStopTimer } = require('../backend/recorder.cjs');
const { ensureDiskSpace } = require('../backend/audio.cjs');

test('max recording is 10 minutes', () => {
  assert.equal(MAX_RECORDING_MS, 10 * 60 * 1000);
});

test('auto-stop timer emits recording-time-limit (normal stop path, never silent cancel)', async () => {
  const sent = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, payload) => sent.push({ channel, payload }) },
  };
  scheduleAutoStopTimer([fakeWindow], 20);
  await new Promise((resolve) => setTimeout(resolve, 100));
  clearAutoStopTimer();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'recording-time-limit');
});

test('clearing the auto-stop timer prevents the time-limit event', async () => {
  const sent = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel) => sent.push(channel) },
  };
  scheduleAutoStopTimer([fakeWindow], 20);
  clearAutoStopTimer();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(sent.length, 0);
});

test('disk check passes when space is sufficient', () => {
  const result = ensureDiskSpace(os.tmpdir(), 1024);
  assert.equal(result.ok, true);
});

test('disk check reports insufficiency without throwing', () => {
  const result = ensureDiskSpace(os.tmpdir(), Number.MAX_SAFE_INTEGER);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
});

test('disk check skips silently where statfs is unavailable', () => {
  const realStatfs = fs.statfsSync;
  // Simulate platforms/Node builds without statfs support.
  fs.statfsSync = undefined;
  try {
    const result = ensureDiskSpace(path.join(os.tmpdir(), 'kimflow-no-such-dir'), 1024);
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
  } finally {
    fs.statfsSync = realStatfs;
  }
});
