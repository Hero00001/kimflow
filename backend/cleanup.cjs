const { formatNumberWords } = require('./format-numbers.cjs');
const { polishText } = require('./polish.cjs');

function cleanupText(text, polishMode = 'thorough') {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const polished = polishText(formatNumberWords(trimmed), polishMode);
  // Collapse whitespace per line so spoken "new line"/"new paragraph"
  // commands survive as real line breaks.
  const normalized = polished
    .split('\n')
    .map((line) => line.split(/\s+/).join(' '))
    .join('\n')
    .trim();

  let result = '';
  let capitalizeNext = true;

  for (const ch of normalized) {
    if (capitalizeNext && /[a-zA-Z]/.test(ch)) {
      result += ch.toUpperCase();
      capitalizeNext = false;
    } else {
      result += ch;
      if (ch === '.' || ch === '!' || ch === '?') {
        capitalizeNext = true;
      }
    }
  }

  const last = result[result.length - 1];
  if (last && !/[.!?]/.test(last)) {
    result += '.';
  }

  return result;
}

module.exports = { cleanupText };