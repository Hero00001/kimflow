'use strict';
// test/theme-accent.test.cjs
//
// applyAccentColor's default-accent branch (QA fix 2026-11-24): when the
// colour equals DEFAULT_ACCENT the three inline custom properties must be
// REMOVED, not set — otherwise backend/settings.cjs (which normalizes the
// stored accentColor to a valid hex, default #8b5cf6) kept the inline
// overrides alive and the light theme's designed black accent (#171717) was
// unreachable.

const test = require('node:test');
const assert = require('node:assert');
const { loadTs } = require('./helpers/ts-loader.cjs');

// theme.ts resolves `document` as a bare global, so install a recording stub
// before the module is loaded.
function installDocumentStub() {
  const calls = [];
  const style = {
    setProperty(name, value) { calls.push({ op: 'set', name, value }); },
    removeProperty(name) { calls.push({ op: 'remove', name }); },
    getPropertyValue() { return ''; },
  };
  globalThis.document = { documentElement: { style } };
  return {
    calls,
    restore() { delete globalThis.document; },
  };
}

const { applyAccentColor, DEFAULT_ACCENT } = loadTs('src/theme.ts');

test('DEFAULT_ACCENT matches backend/settings.cjs DEFAULT_SETTINGS.accentColor', () => {
  assert.equal(DEFAULT_ACCENT, '#8b5cf6');
});

test('the default accent REMOVES the three inline custom properties', () => {
  const stub = installDocumentStub();
  try {
    applyAccentColor('#8b5cf6');
    assert.deepEqual(stub.calls, [
      { op: 'remove', name: '--accent' },
      { op: 'remove', name: '--accent-hover' },
      { op: 'remove', name: '--accent-subtle' },
    ]);
  } finally { stub.restore(); }
});

test('the default accent is matched case-insensitively', () => {
  const stub = installDocumentStub();
  try {
    applyAccentColor('#8B5CF6');
    assert.deepEqual(stub.calls.map((call) => call.op), ['remove', 'remove', 'remove']);
  } finally { stub.restore(); }
});

test('a custom accent still sets all three inline properties', () => {
  const stub = installDocumentStub();
  try {
    applyAccentColor('#171717');
    assert.equal(stub.calls.length, 3);
    assert.ok(stub.calls.every((call) => call.op === 'set'));
    assert.deepEqual(stub.calls.map((call) => call.name), ['--accent', '--accent-hover', '--accent-subtle']);
    assert.equal(stub.calls[0].value, '#171717');
  } finally { stub.restore(); }
});

test('an invalid colour is still ignored entirely', () => {
  const stub = installDocumentStub();
  try {
    applyAccentColor('nope');
    applyAccentColor('#8b5cf');
    applyAccentColor('');
    assert.deepEqual(stub.calls, []);
  } finally { stub.restore(); }
});

test('returning to the default after a custom colour clears the stale inline overrides', () => {
  const stub = installDocumentStub();
  try {
    applyAccentColor('#ff0000');
    stub.calls.length = 0;
    applyAccentColor('#8b5cf6');
    assert.deepEqual(stub.calls.map((call) => call.op), ['remove', 'remove', 'remove'],
      'stale inline props from the custom colour must be removed');
  } finally { stub.restore(); }
});
