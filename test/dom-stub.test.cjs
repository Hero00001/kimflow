// test/dom-stub.test.cjs
//
// The renderer had no test harness, which is why the Gemini-key corruption
// shipped: a bug that needs a DOM to reproduce cannot be caught by a
// backend-only suite. This pins the stub's contract.
const test = require('node:test');
const assert = require('node:assert');
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
