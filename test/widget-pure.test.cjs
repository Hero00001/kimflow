// test/widget-pure.test.cjs
//
// Unit tests for src/widget/widget-pure.js — the pure projection helpers the
// flow-bar widget uses. These are the §9 tests from the design spec plus the
// colour/level helpers, and they must never need a DOM, Electron or a browser.
const test = require('node:test');
const assert = require('node:assert');
const { loadWidgetScript } = require('./helpers/widget-script-loader.cjs');

const fakeWindow = loadWidgetScript('src/widget/widget-pure.js');
const pure = fakeWindow.KimFlowWidgetPure;

test('the namespace is attached to window and exports the documented helpers', () => {
  assert.ok(pure, 'widget-pure.js must attach window.KimFlowWidgetPure');
  for (const name of ['toWidgetState', 'isWidgetState', 'resolveAccentColor', 'clampLevel']) {
    assert.ok(pure[name] !== undefined, `missing ${name}`);
  }
  // The dead reduce()/TABLE state machine was removed (W6): no production
  // file ever referenced it, and a second state machine must not exist even
  // inert. If it ever comes back, this pin fails.
  assert.equal(pure.reduce, undefined, 'reduce must stay deleted');
  assert.equal(pure.TABLE, undefined, 'TABLE must stay deleted');
});

test('the source contains no second state machine (W6)', () => {
  const source = require('node:fs').readFileSync(require('node:path').resolve('src/widget/widget-pure.js'), 'utf8');
  assert.ok(!/function reduce\b/.test(source), 'widget-pure.js must not define reduce()');
  assert.ok(!/\bvar TABLE\b/.test(source), 'widget-pure.js must not carry a transition TABLE');
});

test('toWidgetState maps every recorder state', () => {
  assert.equal(pure.toWidgetState('ready'), 'idle');
  assert.equal(pure.toWidgetState('recording'), 'listening');
  assert.equal(pure.toWidgetState('paused'), 'paused');
  assert.equal(pure.toWidgetState('transcribing'), 'processing');
});

test('toWidgetState is total: anything else is idle', () => {
  for (const value of [undefined, null, '', 'READY', 'stopped', 0, 1, true, {}, [], NaN]) {
    assert.equal(pure.toWidgetState(value), 'idle');
  }
});

test('isWidgetState accepts exactly the four states', () => {
  for (const state of ['idle', 'listening', 'paused', 'processing']) {
    assert.equal(pure.isWidgetState(state), true);
  }
  for (const value of ['', 'IDLE', 'ready', 'recording', null, undefined, 0, {}]) {
    assert.equal(pure.isWidgetState(value), false);
  }
});

test('resolveAccentColor renders the shipped default accent as white', () => {
  assert.equal(pure.resolveAccentColor('#8b5cf6'), '#ffffff');
  assert.equal(pure.resolveAccentColor('#8B5CF6'), '#ffffff');
  assert.equal(pure.resolveAccentColor('  #8b5cf6  '), '#ffffff');
});

test('resolveAccentColor keeps any other valid hex colour', () => {
  assert.equal(pure.resolveAccentColor('#123456'), '#123456');
  assert.equal(pure.resolveAccentColor('#ABCDEF'), '#abcdef');
});

test('resolveAccentColor falls back to white for invalid input', () => {
  for (const value of [null, undefined, '', '#xyz', '#12345', 'red', 0, {}, '#1234567', 'rgb(1,2,3)']) {
    assert.equal(pure.resolveAccentColor(value), '#ffffff');
  }
});

test('clampLevel clamps to 0..1 and rejects non-numbers', () => {
  assert.equal(pure.clampLevel(0), 0);
  assert.equal(pure.clampLevel(0.42), 0.42);
  assert.equal(pure.clampLevel(1), 1);
  assert.equal(pure.clampLevel(2), 1);
  assert.equal(pure.clampLevel(-1), 0);
  for (const value of [NaN, Infinity, -Infinity, '0.5', null, undefined, {}, []]) {
    assert.equal(pure.clampLevel(value), 0);
  }
});
