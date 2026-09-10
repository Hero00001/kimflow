// Rule-based speech polish: the free, offline, no-key lane. Removes filler
// words and repeats, resolves spoken self-corrections, and converts spoken
// punctuation/commands. English only; other languages pass through the
// filler/repeat stages untouched except generic repeat collapse.
const FILLERS = /\b(um|uh|erm|hmm|you know)\b/gi;

const SPOKEN_PUNCTUATION = [
  [/(\s|^)question mark(\s|$)/gi, '$1?$2'],
  [/(\s|^)exclamation(?: mark| point)?(\s|$)/gi, '$1!$2'],
  [/(\s|^)full stop(\s|$)/gi, '$1.$2'],
  [/(\s|^)period(\s|$)/gi, '$1.$2'],
  [/(\s|^)comma(\s|$)/gi, '$1,$2'],
  [/(\s|^)colon(\s|$)/gi, '$1:$2'],
  [/(\s|^)semicolon(\s|$)/gi, '$1;$2'],
];

const SPOKEN_COMMANDS = [
  [/\bnew paragraph\b/gi, '\n\n'],
  [/\bnew line\b/gi, '\n'],
  [/\bbullet point\b/gi, '\n• '],
];

function removeFillers(text) {
  return text.replace(FILLERS, ' ');
}

function collapseRepeats(text) {
  return text.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');
}

// "X actually Y" / "X I mean Y" is treated as a restart: only Y survives.
// A leading marker ("actually, I agree") is emphasis, not a correction.
function resolveCorrections(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const match = sentence.match(/\b(actually|i mean)\b/i);
      if (!match || match.index === undefined) return sentence;
      const before = sentence.slice(0, match.index).trim();
      const after = sentence.slice(match.index + match[0].length).trim();
      if (!before || !after) return sentence;
      return after;
    })
    .join(' ');
}

function applySpokenPunctuation(text) {
  let out = text;
  for (const [pattern, replacement] of SPOKEN_PUNCTUATION) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function applySpokenCommands(text) {
  let out = text;
  for (const [pattern, replacement] of SPOKEN_COMMANDS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function tidy(text) {
  return text
    .split('\n')
    .map((line) => line
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,!?;:])/g, '$1')
      .trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function polishText(text, mode = 'thorough') {
  if (!text || mode === 'off') return text;
  let out = removeFillers(text);
  out = collapseRepeats(out);
  out = applySpokenPunctuation(out);
  if (mode === 'thorough') {
    out = resolveCorrections(out);
    out = applySpokenCommands(out);
  }
  return tidy(out);
}

module.exports = { polishText };
