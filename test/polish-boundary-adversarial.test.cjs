// test/polish-boundary-adversarial.test.cjs
//
// The safer thorough-mode rules from the cleanup rework: self-correction
// restarts fire ONLY on a discourse boundary (comma/pause/filler before the
// marker), and the new phrase-level fillers have strict placement fences.
// Each rule is pinned with its boundary cases, and light mode is pinned to
// bypass ALL of the new rules.
const test = require('node:test');
const assert = require('node:assert');
const { polishText } = require('../backend/polish.cjs');
const { cleanupText } = require('../backend/cleanup.cjs');

// ── restart boundary: sentence-initial markers ──────────────────────────────

test('a marker at the very start of a sentence (after a period) does NOT restart', () => {
  // After the sentence split, "I mean y" has an empty prefix — an empty
  // prefix is emphasis/anew thought, not a correction of "x.".
  assert.equal(polishText('x. I mean y', 'thorough'), 'x. I mean y');
  assert.equal(polishText('Done. Actually we shipped it early', 'thorough'), 'Done. Actually we shipped it early');
});

test('a sentence-initial "I mean, really" stays untouched', () => {
  assert.equal(polishText('I mean, really', 'thorough'), 'I mean, really');
});

test('a comma-bounded "actually" restarts the sentence', () => {
  assert.equal(polishText('the report, actually the draft, needs work', 'thorough'), 'the draft, needs work');
  assert.equal(cleanupText('the report, actually the draft, needs work', 'thorough'), 'The draft, needs work.');
});

test('a semicolon / colon / ellipsis / dash before the marker is a pause boundary', () => {
  assert.equal(polishText('the plan; actually the roadmap, changed', 'thorough'), 'the roadmap, changed');
  assert.equal(polishText('the plan: actually the roadmap, changed', 'thorough'), 'the roadmap, changed');
  assert.equal(polishText('the plan-- actually the roadmap, changed', 'thorough'), 'the roadmap, changed');
  assert.equal(polishText('the plan — actually the roadmap, changed', 'thorough'), 'the roadmap, changed');
  // Unicode ellipsis (listed in PAUSE_BEFORE_MARKER) fires the restart.
  assert.equal(polishText('the plan… actually the roadmap, changed', 'thorough'), 'the roadmap, changed');
  // KNOWN DISCREPANCY (reported to the Engineer, LOW): the ASCII pause "..."
  // is listed in polish.cjs's PAUSE_BEFORE_MARKER, but the sentence splitter
  // (?<=[.!?])\s+ turns "..." into a sentence boundary first, so the marker
  // becomes sentence-initial (empty prefix) and the restart never fires.
  // Actual behaviour is pinned here — conservative (nothing is deleted); if
  // the fix lands, this assertion must be inverted to expect the restart.
  assert.equal(polishText('the plan... actually the roadmap, changed', 'thorough'),
    'the plan... actually the roadmap, changed');
});

test('a run-on intensifier is left alone', () => {
  assert.equal(polishText('I actually needed the blue one', 'thorough'), 'I actually needed the blue one');
  assert.equal(polishText('the report I actually needed was the blue one', 'thorough'),
    'the report I actually needed was the blue one');
});

test('the subject-pronoun guard beats even a comma boundary', () => {
  assert.equal(polishText('the report, I actually needed it', 'thorough'), 'the report, I actually needed it');
});

// ── "kind of" / "sort of" placement fence ───────────────────────────────────

test('utterance-start "kind of" is removed in thorough mode (documented tradeoff)', () => {
  // Pinned ACTUAL behaviour: at utterance start the phrase rule fires even
  // when the continuation is a content usage. This is the accepted
  // ambiguity documented in polish.cjs ("kind of blue" at utterance start
  // is indistinguishable from a discourse opener). Mid-sentence content
  // usage survives — see the next test.
  assert.equal(polishText('kind of blue today', 'thorough'), 'blue today');
  assert.equal(polishText('Sort of. Anyway, we shipped', 'thorough'), 'Anyway, we shipped');
});

test('mid-sentence "kind of" survives', () => {
  assert.equal(polishText('a kind of magic', 'thorough'), 'a kind of magic');
  assert.equal(polishText('I kind of liked it', 'thorough'), 'I kind of liked it');
  assert.equal(polishText('it was sort of blue', 'thorough'), 'it was sort of blue');
});

// ── ", like," placement fence ────────────────────────────────────────────────

test('", like," is removed across sentence boundaries within one utterance', () => {
  assert.equal(polishText('it was, like, great. And, like, done', 'thorough'), 'it was, great. And, done');
});

test('multiple ", like," in one sentence are all removed', () => {
  assert.equal(polishText('it was, like, weird, like, strange', 'thorough'), 'it was, weird, strange');
});

test('a bare "like" survives, including next to non-English words', () => {
  assert.equal(polishText('it was like anything else', 'thorough'), 'it was like anything else');
  assert.equal(polishText('المرضى unlike الـlikely', 'thorough'), 'المرضى unlike الـlikely');
  assert.equal(polishText('مرحبا like بالعالم', 'thorough'), 'مرحبا like بالعالم',
    'a bare "like" in a mixed-language sentence is a content word and survives');
});

// ── robustness ───────────────────────────────────────────────────────────────

test('an empty string passes through every mode', () => {
  assert.equal(polishText('', 'thorough'), '');
  assert.equal(polishText('', 'light'), '');
  assert.equal(cleanupText('', 'thorough'), '');
});

test('light mode bypasses ALL new thorough rules', () => {
  assert.equal(polishText('get coffee or something, I dunno', 'light'), 'get coffee or something, I dunno');
  assert.equal(polishText('x, actually y', 'light'), 'x, actually y');
  assert.equal(polishText('the report, I mean the draft, needs work', 'light'),
    'the report, I mean the draft, needs work');
  assert.equal(polishText('it was, like, great', 'light'), 'it was, like, great');
  assert.equal(polishText('it was, kind of, half finished', 'light'), 'it was, kind of, half finished');
  assert.equal(polishText('sort of. Anyway we shipped', 'light'), 'sort of. Anyway we shipped');
  // The generic filler pass (pre-existing, both modes — NOT a new rule)
  // still applies in light: "um" and "you know" are removed there too, so
  // "you know what I mean" degrades to "what I mean" in light mode exactly
  // as it did before this change set.
  assert.equal(polishText('um hello there', 'light'), 'hello there');
  assert.equal(polishText('it was good, you know what I mean', 'light'),
    'it was good, what I mean');
});

test('off mode is fully verbatim', () => {
  const text = 'the report, I mean the draft, it was, like, great, um, or something';
  assert.equal(cleanupText(text, 'off'), text);
});
