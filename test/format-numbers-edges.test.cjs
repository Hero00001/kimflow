// test/format-numbers-edges.test.cjs
//
// Two independent defects wrote a WRONG NUMBER into the user's document:
//
// (a) A leading "and" was swallowed. `parseRun` skipped "and" with
//     `continue`, so a run that STARTED at "and" had its first word replaced
//     by the number: "I need milk and two eggs" became "I need milk 2 eggs".
//
// (b) Punctuation did not terminate a run. `baseWord` strips trailing
//     punctuation, so "one," compared equal to "one" and the run continued
//     across the comma: "one hundred, two hundred" became 10200.
//
// The rules that follow from English usage:
//   - "and" continues a number only after a scale word ("two hundred and
//     five", "two thousand and nineteen"); otherwise it separates two numbers.
//   - A run never starts at "and"; the word stays in the text.
//   - A word carrying trailing punctuation ends the run, and that punctuation
//     follows the digits.
//   - A unit word directly after the run still wins ("ten dollars" -> $10).
const test = require('node:test');
const assert = require('node:assert');
const { formatNumberWords } = require('../backend/format-numbers.cjs');

test('a conjunction between two numbers is not swallowed', () => {
  assert.equal(formatNumberWords('I need milk and two eggs'), 'I need milk and 2 eggs');
  assert.equal(formatNumberWords('five and six'), '5 and 6');
  assert.equal(
    formatNumberWords('I want three apples and two oranges'),
    'I want 3 apples and 2 oranges',
  );
});

test('a comma separates two numbers instead of summing them', () => {
  assert.equal(formatNumberWords('one, two, three'), '1, 2, 3');
  assert.equal(formatNumberWords('one hundred, two hundred'), '100, 200');
  assert.equal(formatNumberWords('seven, eight, nine'), '7, 8, 9');
});

test('punctuation after a number is preserved', () => {
  assert.equal(formatNumberWords('twenty five.'), '25.');
  assert.equal(formatNumberWords('I have twenty three apples.'), 'I have 23 apples.');
});

test('and still joins a number after a scale word', () => {
  assert.equal(formatNumberWords('two thousand and nineteen'), '2019');
  assert.equal(formatNumberWords('one hundred and five'), '105');
  assert.equal(formatNumberWords('three hundred and forty five'), '345');
});

test('a leading "and" leaves the word in the text', () => {
  assert.equal(formatNumberWords('and two eggs'), 'and 2 eggs');
});

test('the existing conversions still hold', () => {
  assert.equal(formatNumberWords('I have two apples'), 'I have 2 apples');
  assert.equal(formatNumberWords('twenty three people'), '23 people');
  assert.equal(formatNumberWords('nine hundred'), '900');
  assert.equal(formatNumberWords('twenty-three'), '23');
  assert.equal(formatNumberWords('one hundred twenty five'), '125');
  assert.equal(formatNumberWords('a hundred dollars'), '$100');
  assert.equal(formatNumberWords('three point five percent'), '3.5%');
  assert.equal(formatNumberWords('a dog ran away'), 'a dog ran away');
  assert.equal(formatNumberWords('the point is clear'), 'the point is clear');
  assert.equal(formatNumberWords('123'), '123');
  assert.equal(formatNumberWords(''), '');
});
