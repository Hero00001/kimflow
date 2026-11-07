// test/dom-stub.test.cjs
//
// The renderer had no test harness, which is why the Gemini-key corruption
// shipped: a bug that needs a DOM to reproduce cannot be caught by a
// backend-only suite. This pins the stub's contract.
const test = require('node:test');
const assert = require('node:assert');
// Captured before any createDom() in this file has installed the global.
const ORIGINAL_OPTION = Object.getOwnPropertyDescriptor(globalThis, 'Option');
const { createDom } = require('./helpers/dom-stub.cjs');

test('a stub element dispatches a click to its listener with target set', () => {
  const dom = createDom({ 'my-btn': {} });
  const seen = [];
  dom.byId('my-btn').addEventListener('click', (event) => seen.push(event.target));
  dom.dispatch('my-btn', 'click');
  assert.equal(seen.length, 1);
  assert.equal(seen[0], dom.byId('my-btn'));
});

test('classList reflects the active class used by the settings toggle groups', () => {
  const dom = createDom({ 'engine-group': { className: 'toggle-group' } });
  const group = dom.byId('engine-group');
  const button = dom.createButton({ className: 'toggle-btn active', dataset: { value: 'deepgram' } });
  group.append(button);
  assert.equal(group.querySelectorAll('.toggle-btn').length, 1);
  assert.equal(group.querySelectorAll('.toggle-btn')[0].dataset.value, 'deepgram');
});

test('classList stays in sync with className', () => {
  const dom = createDom({ 'btn': {} });
  const btn = dom.byId('btn');
  btn.classList.add('active');
  assert.ok(btn.className.split(' ').includes('active'));
  btn.classList.toggle('active', false);
  assert.ok(!btn.className.split(' ').includes('active'));
  assert.equal(btn.classList.contains('active'), false);
});

test('byId returns the same element every time', () => {
  const dom = createDom({ 'x': {} });
  assert.equal(dom.byId('x'), dom.byId('x'));
});

test('closest walks up to an ancestor carrying the class', () => {
  const dom = createDom({ 'group': { className: 'toggle-group' } });
  const group = dom.byId('group');
  const button = dom.createButton({ className: 'toggle-btn' });
  group.append(button);
  assert.equal(button.closest('.toggle-group'), group);
  assert.equal(button.closest('.toggle-btn'), button);
  assert.equal(button.closest('.nope'), null);
});

test('dispatch merges extra event properties and prevents default', () => {
  const dom = createDom({ 'btn': {} });
  let seen = null;
  dom.byId('btn').addEventListener('click', (event) => { seen = event; });
  dom.dispatch('btn', 'click', { ctrlKey: true, preventDefault() { this.defaultPrevented = true; } });
  assert.equal(seen.ctrlKey, true);
  assert.equal(typeof seen.preventDefault, 'function');
});

// --- B0 harness pins ---------------------------------------------------------
// Each of these MUST fail against the pre-B0 stub; they are the detectors for
// tickets 27 (unknown ids), 28 (<select> semantics) and 29 (bubbling).

test('an undeclared id resolves to null, not a phantom element', () => {
  const dom = createDom({ 'declared-btn': {} });
  assert.equal(dom.document.getElementById('declared-btn'), dom.byId('declared-btn'));
  assert.equal(dom.document.getElementById('engine-download-row-typo'), null);
  assert.equal(dom.byId('another-undeclared-id'), null);
  assert.equal(dom.exports().nonExistentBinding, null);
});

test('a select resets value when no OPTION matches and auto-selects the first option', () => {
  const dom = createDom({ 'mic-select': {} });
  const select = dom.byId('mic-select');
  const first = dom.document.createElement('option');
  first.value = 'default';
  const second = dom.document.createElement('option');
  second.value = 'device-1';
  select.append(first, second);

  assert.equal(first.tagName, 'OPTION', 'tagName must be upper case');
  assert.equal(select.options.length, 2, 'lowercase option tags must still be in options');
  assert.equal(select.value, 'default', 'a browser auto-selects the first option');
  select.value = 'device-1';
  assert.equal(select.value, 'device-1');
  select.value = 'not-in-the-list';
  assert.equal(select.value, '', 'an unmatched value resets to empty');
});

test('dispatched events bubble to ancestor listeners', () => {
  const dom = createDom({ 'group': { className: 'toggle-group' }, 'child': {} });
  const group = dom.byId('group');
  const child = dom.byId('child');
  group.append(child);

  const seen = [];
  group.addEventListener('click', (event) => seen.push({ where: 'group', target: event.target, currentTarget: event.currentTarget }));
  child.addEventListener('click', () => seen.push({ where: 'child' }));

  const event = dom.dispatch('child', 'click');
  assert.deepEqual(seen.map((entry) => entry.where), ['child', 'group']);
  assert.equal(event.target, child);
  assert.equal(seen[1].currentTarget, group);
});

test('stopPropagation prevents ancestors from receiving the event', () => {
  const dom = createDom({ 'group': {}, 'child': {} });
  const group = dom.byId('group');
  const child = dom.byId('child');
  group.append(child);

  const seen = [];
  let stop = false;
  child.addEventListener('click', (event) => {
    seen.push('child');
    if (stop) event.stopPropagation();
  });
  group.addEventListener('click', () => seen.push('group'));

  dom.dispatch('child', 'click');
  assert.deepEqual(seen, ['child', 'group'], 'the event must bubble when it is not stopped');
  stop = true;
  dom.dispatch('child', 'click');
  assert.deepEqual(seen, ['child', 'group', 'child'], 'stopPropagation keeps the event on the target');
});

test('createDom restores the global Option constructor', () => {
  const dom = createDom({});
  assert.equal(typeof globalThis.Option, 'function');
  dom.restore();
  assert.equal(globalThis.Option, ORIGINAL_OPTION === undefined ? undefined : ORIGINAL_OPTION.value);
});
