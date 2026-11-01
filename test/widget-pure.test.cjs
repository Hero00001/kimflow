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
  for (const name of ['reduce', 'TABLE', 'toWidgetState', 'isWidgetState', 'resolveAccentColor', 'clampLevel']) {
    assert.ok(pure[name] !== undefined, `missing ${name}`);
  }
});

test('happy path', () => {
  let s = 'idle';
  for (const [e, want] of [['start', 'listening'], ['pause', 'paused'], ['resume', 'listening'], ['stop', 'processing'], ['done', 'idle']]) {
    s = pure.reduce(s, e);
    assert.equal(s, want);
  }
});

test('cancel returns to idle from listening and paused', () => {
  assert.equal(pure.reduce('listening', 'cancel'), 'idle');
  assert.equal(pure.reduce('paused', 'cancel'), 'idle');
});

test('illegal events are ignored', () => {
  assert.equal(pure.reduce('idle', 'stop'), 'idle');
  assert.equal(pure.reduce('processing', 'pause'), 'processing');
  assert.equal(pure.reduce('idle', 'banana'), 'idle');
  assert.equal(pure.reduce('nonsense', 'start'), 'nonsense');
});

test('reset always lands on idle', () => {
  for (const s of ['idle', 'listening', 'paused', 'processing']) {
    assert.equal(pure.reduce(s, 'reset'), 'idle');
  }
});

test('reduce never throws on garbage input', () => {
  for (const state of [undefined, null, 42, {}, [], '', 'IDLE']) {
    for (const event of [undefined, null, 0, {}, [], 'toString', '__proto__']) {
      assert.doesNotThrow(() => pure.reduce(state, event));
    }
  }
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
