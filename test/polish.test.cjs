const test = require('node:test');
const assert = require('node:assert');
const { polishText } = require('../backend/polish.cjs');

test('light removes fillers and repeated words', () => {
  assert.equal(polishText('Um I went to the the store', 'light'), 'I went to the store');
  assert.equal(polishText('you know it was uh great', 'light'), 'it was great');
});

test('light converts spoken punctuation', () => {
  assert.equal(polishText('hello comma world period', 'light'), 'hello, world.');
  assert.equal(polishText('really question mark', 'light'), 'really?');
});

test('off leaves text untouched', () => {
  assert.equal(polishText('Um hello comma world', 'off'), 'Um hello comma world');
});

test('thorough resolves self-corrections as restarts', () => {
  assert.equal(
    polishText("let's meet at five actually six pm", 'thorough'),
    'six pm',
  );
  assert.equal(polishText('go left I mean right now', 'thorough'), 'right now');
});

test('thorough converts spoken commands', () => {
  assert.equal(polishText('apples new line oranges', 'thorough'), 'apples\noranges');
  assert.equal(polishText('intro new paragraph body', 'thorough'), 'intro\n\nbody');
});

test('keeps leading actually and substrings', () => {
  assert.equal(polishText('actually I agree', 'thorough'), 'actually I agree');
  assert.equal(polishText('the commander arrived', 'light'), 'the commander arrived');
});
