// English number-words to digits (inverse text normalization) for the
// transcription cleanup pipeline. whisper.cpp emits no formatting at all,
// and cloud formatters can miss entities in short utterances, so this is
// the shared safety net for every engine. English only; other languages
// pass through untouched.
const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALES = { hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 };
const DECIMAL_DIGITS = { ...ONES, oh: 0 };
const NUMBER_WORDS = new Set([
  ...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(SCALES),
  'and', 'point', 'a', 'an', 'oh',
  'percent', 'percentage', 'dollar', 'dollars', 'buck', 'bucks',
]);

function splitPunctuation(token) {
  const match = token.match(/^([A-Za-z]+)([.,!?;:]+)$/);
  if (match) return { word: match[1], suffix: match[2] };
  return { word: token, suffix: '' };
}

function baseWord(token) {
  return splitPunctuation(token).word.toLowerCase();
}

// Parse a run of number WORDS (no whitespace entries) starting at `start`.
// Returns null when the run is not a number, otherwise
// { value, next, unitSuffix } with `next` past the last consumed word.
function parseRun(words, start) {
  let total = 0;
  let current = 0;
  let hasNumber = false;
  let i = start;

  for (; i < words.length; i += 1) {
    const lower = baseWord(words[i]);
    if (lower === 'and') continue;
    if (lower === 'a' || lower === 'an') {
      if (baseWord(words[i + 1] || '') in SCALES) {
        current += 1;
        hasNumber = true;
        continue;
      }
      break;
    }
    if (lower in ONES) {
      current += ONES[lower];
      hasNumber = true;
      continue;
    }
    if (lower in TENS) {
      current += TENS[lower];
      hasNumber = true;
      continue;
    }
    if (lower in SCALES) {
      const scale = SCALES[lower];
      if (scale === 100) {
        current = (current || 1) * scale;
      } else {
        total += (current || 1) * scale;
        current = 0;
      }
      hasNumber = true;
      continue;
    }
    if (lower === 'point' && hasNumber) {
      let digits = '';
      let j = i + 1;
      while (j < words.length && baseWord(words[j]) in DECIMAL_DIGITS) {
        digits += String(DECIMAL_DIGITS[baseWord(words[j])]);
        j += 1;
      }
      if (!digits) return null;
      return finishWithUnit(words, `${total + current}.${digits}`, j);
    }
    break;
  }

  if (!hasNumber) return null;
  return finishWithUnit(words, String(total + current), i);
}

function finishWithUnit(words, value, next) {
  const unit = baseWord(words[next] || '');
  const { suffix } = splitPunctuation(words[next] || '');
  if (unit === 'percent' || unit === 'percentage') {
    return { value: `${value}%`, next: next + 1, unitSuffix: suffix };
  }
  if (unit === 'dollar' || unit === 'dollars' || unit === 'buck' || unit === 'bucks') {
    return { value: `$${value}`, next: next + 1, unitSuffix: suffix };
  }
  return { value, next, unitSuffix: '' };
}

function formatNumberWords(text) {
  if (!text || !/[a-zA-Z]/.test(text)) return text;
  // "twenty-three" -> "twenty three" (only when both sides are number words).
  const dehyphenated = text.replace(/\b([A-Za-z]+)-([A-Za-z]+)\b/g, (m, a, b) => (
    NUMBER_WORDS.has(a.toLowerCase()) && NUMBER_WORDS.has(b.toLowerCase()) ? `${a} ${b}` : m
  ));
  const parts = dehyphenated.split(/(\s+)/);
  const isWord = parts.map((p) => !/^\s*$/.test(p));
  const words = [];
  const wordPart = [];
  parts.forEach((p, k) => {
    if (isWord[k]) {
      words.push(p);
      wordPart.push(k);
    }
  });

  const replacement = new Map();
  const consumed = new Set();
  let w = 0;
  while (w < words.length) {
    if (!NUMBER_WORDS.has(baseWord(words[w]))) {
      w += 1;
      continue;
    }
    const parsed = parseRun(words, w);
    if (!parsed) {
      w += 1;
      continue;
    }
    const { suffix } = splitPunctuation(words[w]);
    replacement.set(w, parsed.value + (parsed.unitSuffix || suffix));
    for (let k = w + 1; k < parsed.next; k += 1) consumed.add(k);
    w = parsed.next;
  }

  const out = [];
  let wi = 0;
  for (let k = 0; k < parts.length; k += 1) {
    if (!isWord[k]) {
      // Drop separators strictly inside a converted run; keep the rest
      // (including paragraph breaks from cloud formatters).
      const prev = wi - 1;
      const nextWord = wi;
      if ((replacement.has(prev) || consumed.has(prev)) && consumed.has(nextWord)) continue;
      out.push(parts[k]);
      continue;
    }
    if (consumed.has(wi)) {
      wi += 1;
      continue;
    }
    out.push(replacement.has(wi) ? replacement.get(wi) : parts[k]);
    wi += 1;
  }
  return out.join('');
}

module.exports = { formatNumberWords };
