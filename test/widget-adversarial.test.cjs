// test/widget-adversarial.test.cjs
//
// Hostile-input tests for the flow-bar widget's pure projection layer and its
// geometry. Every assertion here fails if the corresponding guard is removed,
// which is the point: the earlier suites assert the happy path, this one
// asserts that garbage can never escape the four-state vocabulary or the
// 260x64 window.
//
// Nothing in this file needs a DOM, Electron or a browser.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadWidgetScript } = require('./helpers/widget-script-loader.cjs');

const {
  WIN_W,
  WIN_H,
  CAPSULE_SIZES,
  computeWidgetBounds,
  capsuleRectForState,
} = require('../backend/widget-window.cjs');

const pure = loadWidgetScript('src/widget/widget-pure.js').KimFlowWidgetPure;
const WIDGET_STATES = ['idle', 'listening', 'paused', 'processing'];

// ---------------------------------------------------------------------------
// The reduce()/TABLE state machine was deleted (W6, dead code in production).
// Its prototype-pollution duties transfer to toWidgetState, which keeps its
// own hasOwn guard and its hostile-input tests below.
// ---------------------------------------------------------------------------

test('the deleted state machine stays deleted', () => {
  for (const key of ['reduce', 'TABLE']) {
    assert.equal(pure[key], undefined, `pure.${key} must not exist`);
  }
  assert.equal({}.polluted, undefined, 'prototype pollution leaked onto Object.prototype');
});

// ---------------------------------------------------------------------------
// toWidgetState(): only strings are recorder states, everything else is idle.
// ---------------------------------------------------------------------------

test('toWidgetState() maps every non-string to idle', () => {
  for (const value of [undefined, null, 0, 42, {}, [], true, false, NaN, Infinity, () => {}, Symbol('x')]) {
    assert.equal(pure.toWidgetState(value), 'idle', `non-string ${String(value)} must map to idle`);
  }
});

test('toWidgetState() never resolves a prototype key', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.equal(pure.toWidgetState(key), 'idle');
  }
});

test('toWidgetState() always returns one of the four states', () => {
  const corpus = [
    ...WIDGET_STATES, 'ready', 'recording', 'paused', 'transcribing', 'error', 'stopped',
    '', ' ', 'IDLE', 'Recording', 'READY', '__proto__', 'constructor',
    undefined, null, 0, 1, -1, NaN, {}, [], true, false,
  ];
  for (const value of corpus) {
    const mapped = pure.toWidgetState(value);
    assert.ok(WIDGET_STATES.includes(mapped), `toWidgetState(${String(value)}) => ${String(mapped)}`);
  }
});

// ---------------------------------------------------------------------------
// capsuleRectForState(): accepts widget AND recorder states, always inside the
// window, always bottom-aligned, always integral.
// ---------------------------------------------------------------------------

test('capsuleRectForState() accepts both vocabularies and garbage', () => {
  const byWidgetState = {};
  for (const state of WIDGET_STATES) byWidgetState[state] = capsuleRectForState(state);

  assert.deepEqual(capsuleRectForState('ready'), byWidgetState.idle);
  assert.deepEqual(capsuleRectForState('recording'), byWidgetState.listening);
  assert.deepEqual(capsuleRectForState('paused'), byWidgetState.paused);
  assert.deepEqual(capsuleRectForState('transcribing'), byWidgetState.processing);

  for (const garbage of [undefined, null, 0, 42, {}, [], true, '', 'banana', 'IDLE', '__proto__', 'constructor', 'toString']) {
    assert.deepEqual(capsuleRectForState(garbage), byWidgetState.idle, `garbage ${String(garbage)} must fall back to idle`);
  }
});

test('every capsule rect fits the window, is bottom-aligned and integral', () => {
  const states = [
    ...WIDGET_STATES, 'ready', 'recording', 'paused', 'transcribing',
    undefined, null, 'banana', '', '__proto__',
  ];
  for (const state of states) {
    const rect = capsuleRectForState(state);
    const label = String(state);
    for (const key of ['x', 'y', 'w', 'h']) {
      assert.ok(Number.isInteger(rect[key]), `${label}: ${key} is not an integer (${rect[key]})`);
    }
    assert.ok(rect.x >= 0, `${label}: capsule overflows the left edge`);
    assert.ok(rect.x + rect.w <= WIN_W, `${label}: capsule overflows the right edge`);
    assert.ok(rect.y >= 0, `${label}: capsule overflows the top edge`);
    assert.equal(rect.y + rect.h, WIN_H, `${label}: capsule must sit on the window's bottom edge`);
    assert.ok(rect.w > 0 && rect.h > 0, `${label}: capsule must have a positive size`);
  }
});

test('the four capsule sizes are exactly the spec dimensions', () => {
  assert.deepEqual(CAPSULE_SIZES, {
    idle: { w: 70, h: 22 },
    listening: { w: 204, h: 42 },
    paused: { w: 204, h: 42 },
    processing: { w: 78, h: 28 },
  });
});

// ---------------------------------------------------------------------------
// computeWidgetBounds(): monitors to the left of / above the primary one, and
// integral output for fractional work areas.
// ---------------------------------------------------------------------------

test('computeWidgetBounds() handles a monitor to the LEFT of the primary one', () => {
  const bounds = computeWidgetBounds({ x: -1920, y: 0, width: 1920, height: 1040 });
  assert.deepEqual(bounds, { x: -1920 + 830, y: 1040 - WIN_H - 20, width: WIN_W, height: WIN_H });
  assert.ok(bounds.x < 0, 'a left-hand monitor legitimately yields a negative origin');
  assert.equal(bounds.x + WIN_W / 2, -1920 + 960, 'the window must stay centred on that monitor');
});

test('computeWidgetBounds() handles a monitor ABOVE the primary one', () => {
  const bounds = computeWidgetBounds({ x: 0, y: -1080, width: 1920, height: 1040 });
  assert.deepEqual(bounds, { x: 830, y: -1080 + 1040 - WIN_H - 20, width: WIN_W, height: WIN_H });
  assert.ok(bounds.y < 0);
});

test('computeWidgetBounds() always returns integers, even for fractional work areas', () => {
  const areas = [
    { x: 0, y: 0, width: 1920, height: 1080 },
    { x: -1919.5, y: 0.5, width: 1919.4, height: 1039.6 },
    { x: 0.33, y: -0.67, width: 1280.5, height: 1024.25 },
    { x: -2560, y: -1440, width: 2560, height: 1400 },
  ];
  for (const area of areas) {
    const bounds = computeWidgetBounds(area);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Number.isInteger(bounds[key]), `${JSON.stringify(area)}: ${key} is not an integer`);
    }
    assert.equal(bounds.width, WIN_W);
    assert.equal(bounds.height, WIN_H);
  }
});

test('computeWidgetBounds() never returns NaN for a malformed work area', () => {
  const malformed = [
    null, undefined, {}, { x: 0, y: 0 },
    { x: '0', y: 0, width: 1920, height: 1080 },
    { x: 0, y: 0, width: NaN, height: 1080 },
    { x: 0, y: 0, width: Infinity, height: 1080 },
  ];
  for (const area of malformed) {
    const bounds = computeWidgetBounds(area);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Number.isFinite(bounds[key]), `${JSON.stringify(area)}: ${key} is ${bounds[key]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The CSS <-> CAPSULE_SIZES drift guard must not be vacuous.
// ---------------------------------------------------------------------------

const CSS_PATH = path.join('src', 'widget', 'widget.css');

/** The same parse test/widget-window.test.cjs performs. */
function capsuleSizesFromCss(css) {
  const sizes = {};
  const rule = /\[data-state="([a-z]+)"\]\s*\.pill\s*\{([^}]*)\}/g;
  let match = rule.exec(css);
  while (match !== null) {
    const width = /--w:\s*([\d.]+)px/.exec(match[2]);
    const height = /--h:\s*([\d.]+)px/.exec(match[2]);
    if (width && height) sizes[match[1]] = { w: Number(width[1]), h: Number(height[1]) };
    match = rule.exec(css);
  }
  return sizes;
}

test('the CSS parser really reads the four capsule rules (guard is not vacuous)', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const parsed = capsuleSizesFromCss(css);
  assert.deepEqual(Object.keys(parsed).sort(), ['idle', 'listening', 'paused', 'processing']);
  assert.deepEqual(parsed, CAPSULE_SIZES, 'widget.css drifted from CAPSULE_SIZES');
});

test('changing a --w value in the CSS would be detected by the drift guard', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  // Mutate a copy: 70px -> 71px for the idle capsule.
  const mutated = css.replace(/(\[data-state="idle"\]\s*\.pill\{--w:)70px/, (match, prefix) => `${prefix}71px`);
  assert.notEqual(mutated, css, 'the mutation must actually change the stylesheet');
  assert.notDeepEqual(capsuleSizesFromCss(mutated), CAPSULE_SIZES, 'the drift guard would miss a width change');
  assert.equal(capsuleSizesFromCss(mutated).idle.w, 71);

  // ...and so would a height change.
  const taller = css.replace(
    /(\[data-state="processing"\]\s*\.pill\{--w:78px;\s*--h:)28px/,
    (match, prefix) => `${prefix}29px`,
  );
  assert.notEqual(taller, css);
  assert.equal(capsuleSizesFromCss(taller).processing.h, 29);
  assert.notDeepEqual(capsuleSizesFromCss(taller), CAPSULE_SIZES);
});

test('the drift guard only picks up [data-state] .pill rules, not :root tokens', () => {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  // :root declares --live/--fg etc. but no --w/--h, so no phantom state may
  // appear in the parsed map.
  const parsed = capsuleSizesFromCss(css);
  assert.equal(parsed.root, undefined);
  assert.equal(Object.keys(parsed).length, 4);
});
