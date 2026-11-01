// test/polish-thorough.test.cjs
//
// Every thorough-mode addition must have a POSITIVE case (the rule fires)
// and a NEGATIVE case (content that must survive). The default polishMode
// changed from 'thorough' to 'light', so these rules only apply to users
// who explicitly opt in.
const test = require('node:test');
const assert = require('node:assert');
const { polishText } = require('../backend/polish.cjs');
const { cleanupText } = require('../backend/cleanup.cjs');
const settings = require('../backend/settings.cjs');

// ── ", like," — comma-delimited discourse "like" ────────────────────────────

test('comma-delimited discourse like is removed', () => {
  assert.equal(polishText('it was, like, great', 'thorough'), 'it was, great');
  assert.equal(cleanupText('it was, like, great', 'thorough'), 'It was, great.');
});

test('a bare content "like" survives', () => {
  assert.equal(polishText('I like pizza', 'thorough'), 'I like pizza');
  assert.equal(polishText('it was unlike anything else', 'thorough'), 'it was unlike anything else');
  assert.equal(polishText('it was like anything else', 'thorough'), 'it was like anything else');
});

// ── "kind of" / "sort of" — discourse markers only ──────────────────────────

test('utterance-start kind of / sort of is removed', () => {
  assert.equal(polishText('Kind of, it worked', 'thorough'), 'it worked');
  assert.equal(polishText('sort of. Anyway, we shipped', 'thorough'), 'Anyway, we shipped');
});

test('kind of / sort of before a comma is removed', () => {
  assert.equal(polishText('it was, kind of, half finished', 'thorough'), 'it was, half finished');
  assert.equal(polishText('I was, sort of, expecting that', 'thorough'), 'I was, expecting that');
});

test('content kind of / sort of survives', () => {
  assert.equal(polishText('kind of blue is a great album', 'light'), 'kind of blue is a great album');
  // Mid-sentence, before no comma: a content usage — must survive even in
  // thorough mode.
  assert.equal(polishText('I kind of liked it', 'thorough'), 'I kind of liked it');
  assert.equal(polishText('it was sort of blue', 'thorough'), 'it was sort of blue');
});

// ── "or something" ──────────────────────────────────────────────────────────

test('trailing hedge "or something" is removed', () => {
  assert.equal(polishText('get coffee or something', 'thorough'), 'get coffee');
  assert.equal(polishText('call him or something, I dunno', 'thorough'), 'call him, I dunno');
});

test('a plain content "something" survives', () => {
  assert.equal(polishText('I need something', 'thorough'), 'I need something');
  assert.equal(polishText('salad or soup', 'thorough'), 'salad or soup');
});

// ── "you know what I mean" ──────────────────────────────────────────────────

test('the full discourse phrase "you know what I mean" is removed', () => {
  assert.equal(polishText('it was good, you know what I mean', 'thorough'), 'it was good');
  assert.equal(polishText('you know what I mean it was good', 'thorough'), 'it was good');
});

test('similar-but-different phrases survive', () => {
  assert.equal(polishText('I know what I mean', 'thorough'), 'I know what I mean');
  assert.equal(polishText('You knew what I mean', 'thorough'), 'You knew what I mean');
});

// ── safer self-correction restarts ──────────────────────────────────────────

test('a comma-bounded "I mean" restarts the sentence', () => {
  assert.equal(polishText('the report, I mean the draft, needs work', 'thorough'), 'the draft, needs work');
  assert.equal(cleanupText('the report, I mean the draft, needs work', 'thorough'), 'The draft, needs work.');
});

test('a marker that runs on without punctuation is left alone', () => {
  assert.equal(polishText('the report I actually needed', 'thorough'), 'the report I actually needed');
  assert.equal(polishText('the report I mean to finish', 'thorough'), 'the report I mean to finish');
  assert.equal(polishText("let's meet at five actually six pm", 'thorough'), "let's meet at five actually six pm");
});

test('a filler before the marker marks a false start and restarts', () => {
  assert.equal(polishText('um actually I meant the draft', 'thorough'), 'I meant the draft');
  assert.equal(polishText('uh, I mean, the red one', 'thorough'), 'the red one');
});

test('the subject-pronoun guard for actually still wins over a comma', () => {
  assert.equal(polishText('the report, I actually needed it', 'thorough'), 'the report, I actually needed it');
});

// ── English-only fence ──────────────────────────────────────────────────────

test('non-English sentences pass through thorough untouched', () => {
  assert.equal(polishText('مرحبا بالعالم الجميل', 'thorough'), 'مرحبا بالعالم الجميل');
  assert.equal(polishText('你好，美丽的世界', 'thorough'), '你好，美丽的世界');
});

// ── cleanup default ─────────────────────────────────────────────────────────

test('fresh settings normalize polishMode to light', () => {
  assert.equal(settings.DEFAULT_SETTINGS.polishMode, 'light');
  assert.equal(settings.normalizeSettings({}).polishMode, 'light');
});

test('an explicit stored thorough survives normalization', () => {
  assert.equal(settings.normalizeSettings({ polishMode: 'thorough' }).polishMode, 'thorough');
  assert.equal(settings.normalizeSettings({ polishMode: 'light' }).polishMode, 'light');
  assert.equal(settings.normalizeSettings({ polishMode: 'off' }).polishMode, 'off');
  assert.equal(settings.normalizeSettings({ polishMode: 'aggressive' }).polishMode, 'light');
});
