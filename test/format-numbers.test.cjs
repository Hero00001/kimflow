const test = require('node:test');
const assert = require('node:assert');
const { formatNumberWords } = require('../backend/format-numbers.cjs');
const { cleanupText } = require('../backend/cleanup.cjs');
const { deepgramOptions } = require('../backend/engines/deepgram.cjs');

test('converts plain cardinals', () => {
  assert.equal(formatNumberWords('I have two apples'), 'I have 2 apples');
  assert.equal(formatNumberWords('twenty three people'), '23 people');
  assert.equal(formatNumberWords('nine hundred'), '900');
});

test('converts hyphenated and scaled numbers', () => {
  assert.equal(formatNumberWords('twenty-three'), '23');
  assert.equal(formatNumberWords('one hundred twenty five'), '125');
  assert.equal(formatNumberWords('two thousand and nineteen'), '2019');
  assert.equal(formatNumberWords('a hundred dollars'), '$100');
  assert.equal(formatNumberWords('three point five percent'), '3.5%');
});

test('leaves non-numbers and other languages alone', () => {
  assert.equal(formatNumberWords('a dog ran away'), 'a dog ran away');
  assert.equal(formatNumberWords('the point is clear'), 'the point is clear');
  assert.equal(formatNumberWords('123'), '123');
  assert.equal(formatNumberWords(''), '');
});

test('cleanup pipeline converts numbers then formats', () => {
  assert.equal(cleanupText('i have twenty three apples'), 'I have 23 apples.');
});

test('deepgram requests numeral formatting', () => {
  const options = deepgramOptions('auto', 'nova-3');
  assert.equal(options.smart_format, true);
  assert.equal(options.numerals, true);
});
