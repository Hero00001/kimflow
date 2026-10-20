// test/polish-emphasis.test.cjs
//
// Regression test for the MEDIUM-HIGH defect: "actually" as emphasis deleted
// the sentence prefix.
//
// The self-correction rule ("X actually Y" is a restart, only Y survives)
// is intended and pinned by test/polish.test.cjs. But "actually" is also a
// common English intensifier, and the rule fired on it unconditionally:
//
//   "The report I actually needed was the blue one"
//     -> "needed was the blue one"   (the prefix is silently deleted)
//
// A subject pronoun immediately before the marker is a reliable signal of
// emphasis rather than correction: "I actually", "we actually", "they
// actually". A correction marker instead follows a complete phrase, as in
// "let's meet at five actually six pm".
const test = require('node:test');
const assert = require('node:assert');
const { polishText } = require('../backend/polish.cjs');

test('actually after a pronoun is emphasis, not a correction', () => {
  // polishText does not capitalise or add a full stop — that is cleanupText's
  // job — so the expectation is the sentence with its prefix intact.
  assert.equal(
    polishText('The report I actually needed was the blue one', 'thorough'),
    'The report I actually needed was the blue one',
  );
  assert.equal(polishText('I think I actually like it', 'thorough'), 'I think I actually like it');
  assert.equal(polishText('we actually finished it', 'thorough'), 'we actually finished it');
});

test('actually after ordinary words still restarts the sentence', () => {
  // polishText does not capitalise or add a full stop — that is cleanupText's
  // job — so the expected values are the bare polished sentences.
  assert.equal(polishText("let's meet at five actually six pm", 'thorough'), 'six pm');
  assert.equal(polishText('go left I mean right now', 'thorough'), 'right now');
});

test('a leading actually is still emphasis', () => {
  assert.equal(polishText('actually I agree', 'thorough'), 'actually I agree');
});
