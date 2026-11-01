// Rule-based speech polish: the free, offline, no-key lane. Removes filler
// words and repeats, resolves spoken self-corrections, and converts spoken
// punctuation/commands. English only: every rule below matches English
// words/phrases, so sentences in other languages pass through the
// filler/repeat stages untouched except the generic repeat collapse.
//
// Thorough mode adds two groups of rules, both run on the RAW text (before
// the generic filler pass, which would destroy the evidence they need):
//
// Phrase-level fillers (unambiguous only):
//   - ", like," — comma-delimited discourse "like" ("it was, like, great").
//     A bare "like" is a content word ("I like pizza") and survives.
//   - "or something" — trailing hedge ("get coffee or something").
//   - "you know what I mean" — full discourse phrase; must run before the
//     generic filler pass, which would otherwise delete only "you know" and
//     leave the meaningless remainder "what I mean".
//   - "kind of" / "sort of" ONLY at utterance start or directly before a
//     comma ("Kind of, it worked"). Elsewhere they are content words
//     ("kind of blue") and must survive.
//
// Self-correction restarts fire ONLY on a real discourse boundary in the raw
// text: a comma or pause right before the marker ("the report, I mean the
// draft, needs work" -> "the draft, needs work"), or a filler word directly
// before it ("um actually I meant the draft"). A marker that runs on without
// punctuation ("the report I actually needed") is left alone — deleting the
// prefix there destroyed valid sentences. The subject-pronoun guard for
// "actually" ("I actually needed it" is emphasis, not correction) stays.
const FILLERS = /\b(um|uh|erm|hmm|you know)\b/gi;

// Applied in order; each entry is [pattern, replacement].
const THOROUGH_FILLER_RULES = [
  // "it was, like, great" -> "it was, great". Requires commas on both sides,
  // so "I like pizza" and "unlike" are untouched.
  [/\s*,\s*\blike\b\s*,/gi, ','],
  // "it was, kind of, blue" -> "it was, blue" (discourse usage; the content
  // usage "kind of blue" has no commas and never matches).
  [/\s*,\s*\b(?:kind of|sort of)\b\s*,/gi, ','],
  // "get coffee or something" -> "get coffee". A plain "something" without
  // the leading "or" is content and survives.
  [/\s+,?\s*\bor something\b/gi, ''],
  // "It was good, you know what I mean" -> "It was good". Consumes an
  // optional preceding comma; must run before the generic filler pass.
  [/\s*,?\s*\byou know what i mean\b/gi, ''],
  // Utterance-start "Kind of, it worked" / "Sort of. Anyway …" -> the rest.
  // Only at line start (multiline ^), optionally consuming one closing
  // punctuation mark and surrounding space.
  [/^\s*(?:kind of|sort of)\b[,;.!?]?\s*/gim, ''],
];

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

function applyThoroughFillers(text) {
  let out = text;
  for (const [pattern, replacement] of THOROUGH_FILLER_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function collapseRepeats(text) {
  return text.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');
}

// Subject pronouns. When one of these immediately precedes "actually", the
// marker is an intensifier ("I actually needed it"), not a self-correction.
const SUBJECT_PRONOUNS = new Set([
  'i', 'we', 'you', 'he', 'she', 'they', 'it', 'that', 'this', 'there', 'here',
]);

// Spoken fillers that mark the word before a correction marker as a false
// start ("um actually I meant the draft"), making the marker a restart even
// without a comma. Multi-word tails are checked too ("you know actually …",
// "sort of actually …").
const FILLER_TAILS = new Set([
  'um', 'uh', 'erm', 'hmm', 'like', 'you know', 'sort of', 'kind of',
]);

// A comma, semicolon, colon or written pause (…, ..., --, —) immediately
// before the marker.
const PAUSE_BEFORE_MARKER = /(?:,|;|:|\.\.\.|…|--|—)\s*$/;

function precededByPause(rawBefore) {
  return PAUSE_BEFORE_MARKER.test(rawBefore);
}

function precededByFiller(rawBefore) {
  const words = rawBefore.trimEnd().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const last = words[words.length - 1];
  if (FILLER_TAILS.has(last)) return true;
  if (words.length >= 2 && FILLER_TAILS.has(`${words[words.length - 2]} ${last}`)) return true;
  return false;
}

// "X, actually Y" / "X, I mean Y" is treated as a restart: only Y survives.
// A leading marker ("actually, I agree") is emphasis, not a correction.
//
// "actually" is a common English intensifier, and the rule used to fire on it
// unconditionally, deleting the sentence prefix: "The report I actually
// needed was the blue one" became "needed was the blue one". Two fences now
// prevent that: a subject pronoun right before the marker marks it as
// emphasis, and — new — the marker must sit on a discourse boundary (comma,
// pause, or a preceding filler). "I mean" is unambiguous as a PHRASE but the
// same boundary rule applies: "go left I mean right now" spoken as one run is
// left alone, while "go left, I mean right now" restarts.
function resolveCorrections(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      const match = sentence.match(/\b(actually|i mean)\b/i);
      if (!match || match.index === undefined) return sentence;
      const rawBefore = sentence.slice(0, match.index);
      const before = rawBefore.trim();
      // A comma directly AFTER the marker ("uh, I mean, the red one") is part
      // of the false start, not part of the correction — drop it with the
      // prefix.
      const after = sentence.slice(match.index + match[0].length).replace(/^\s*,\s*/, '').trim();
      if (!before || !after) return sentence;
      if (match[0].toLowerCase() === 'actually') {
        const previousWord = (before.match(/([A-Za-z']+)$/) || [])[1] || '';
        if (SUBJECT_PRONOUNS.has(previousWord.toLowerCase())) return sentence;
      }
      // Fire only on a real discourse boundary. Without one ("the report I
      // actually needed"), the marker may be an intensifier — keep the text.
      if (!precededByPause(rawBefore) && !precededByFiller(rawBefore)) return sentence;
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
  let out = text;
  if (mode === 'thorough') {
    // Thorough-only rules run on the RAW text: the phrase-level fillers
    // ("you know what I mean") would be chopped up by the generic filler
    // pass, and the correction rule needs the commas/pauses/fillers that
    // pass removes.
    out = applyThoroughFillers(out);
    out = resolveCorrections(out);
  }
  out = removeFillers(out);
  out = collapseRepeats(out);
  out = applySpokenPunctuation(out);
  if (mode === 'thorough') {
    out = applySpokenCommands(out);
  }
  return tidy(out);
}

module.exports = { polishText };
