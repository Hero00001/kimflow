function cleanupText(text) {
  const trimmed = text.trim();
  if (!trimmed) return '';

  const normalized = trimmed.split(/\s+/).join(' ');

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