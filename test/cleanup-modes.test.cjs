// test/cleanup-modes.test.cjs
//
// The UI offers a Speech Cleanup mode of "Off" (src/i18n/locales/en.ts).
// `polishText` honoured it; `cleanupText` did not — it always converted
// number words, capitalised every sentence and appended a full stop. So a
// user who turned cleanup off still got rewritten text pasted into their
// application.
const test = require('node:test');
const assert = require('node:assert');
const { cleanupText } = require('../backend/cleanup.cjs');
const { polishText } = require('../backend/polish.cjs');

test('off leaves the transcript untouched', () => {
  assert.equal(cleanupText('i have twenty three apples', 'off'), 'i have twenty three apples');
  assert.equal(cleanupText('Um hello comma world', 'off'), 'Um hello comma world');
  assert.equal(cleanupText('  hello there  ', 'off'), 'hello there');
  assert.equal(cleanupText('', 'off'), '');
});

test('light still removes fillers and converts spoken punctuation', () => {
  assert.equal(cleanupText('Um hello comma world', 'light'), 'Hello, world.');
});

test('thorough still resolves self-corrections', () => {
  // "five actually six" is a self-correction: only the correction survives.
  assert.equal(cleanupText("let's meet at five actually six pm", 'thorough'), '6 Pm.');
});

test('the default mode is thorough', () => {
  assert.equal(cleanupText('i have twenty three apples'), 'I have 23 apples.');
});

test('polishText and cleanupText agree about what "off" means', () => {
  const text = 'Um hello comma world';
  assert.equal(polishText(text, 'off'), text);
  assert.equal(cleanupText(text, 'off'), text);
});
