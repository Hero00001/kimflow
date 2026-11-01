'use strict';
// Unit tests for the perceptual microphone-level mapping
// (src/audio/level.ts) that feeds the flow-bar widget's audio-reactive
// bars. The mapping is the whole fix for "the bars only move when I
// shout": normal speech must land in the visible middle of the range,
// not at the floor.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/ts-loader.cjs');

const { micLevelFromRms } = loadTs(require('path').join(__dirname, '..', 'src', 'audio', 'level.ts'));

test('micLevelFromRms: silence and non-numbers map to 0', () => {
  assert.equal(micLevelFromRms(0), 0);
  assert.equal(micLevelFromRms(-1), 0);
  assert.equal(micLevelFromRms(NaN), 0);
  assert.equal(micLevelFromRms(Infinity), 1); // infinitely loud -> ceiling
  assert.equal(micLevelFromRms(undefined), 0);
  assert.equal(micLevelFromRms(null), 0);
  assert.equal(micLevelFromRms('loud'), 0);
});

test('micLevelFromRms: anchor points of the dB window', () => {
  // -60 dB -> 0, -40 dB -> 0.5, -20 dB -> 1
  assert.equal(micLevelFromRms(0.001), 0); // 10^(-60/20)
  assert.equal(micLevelFromRms(0.01), 0.5); // 10^(-40/20)
  assert.equal(micLevelFromRms(0.1), 1); // 10^(-20/20)
});

test('micLevelFromRms: normal speech lands mid-range, not at the floor', () => {
  // The old linear mapping (rms * 3) put these at 0.03-0.24, which the
  // widget floored to its minimum bar height.
  const quiet = micLevelFromRms(0.003);
  const normal = micLevelFromRms(0.02);
  assert.ok(quiet >= 0.2 && quiet <= 0.4, `quiet speech ${quiet} should be ~0.25`);
  assert.ok(normal >= 0.6 && normal <= 0.8, `normal speech ${normal} should be ~0.7`);
});

test('micLevelFromRms: monotonic across the speech range', () => {
  const samples = [0.0005, 0.001, 0.003, 0.01, 0.02, 0.05, 0.1, 0.3];
  for (let i = 1; i < samples.length; i += 1) {
    assert.ok(
      micLevelFromRms(samples[i]) >= micLevelFromRms(samples[i - 1]),
      `level must not decrease as input grows (${samples[i - 1]} -> ${samples[i]})`,
    );
  }
});

test('micLevelFromRms: output is always within 0..1', () => {
  for (let rms = 0.0001; rms <= 1; rms *= 1.7) {
    const level = micLevelFromRms(rms);
    assert.ok(level >= 0 && level <= 1, `level ${level} out of range for rms ${rms}`);
  }
});
