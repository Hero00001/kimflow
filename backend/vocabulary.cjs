// Custom vocabulary ("Words I say") mapping. One user-edited word list,
// translated into each engine's native vocabulary boost:
// - Deepgram nova-3: repeated `keyterm` params (plain terms, no weights)
// - Deepgram nova-2: `keywords` with a mild intensifier
// - Speechmatics: `additional_vocab` content entries
// - Local whisper.cpp: initial `--prompt` text
const MAX_TERMS = 100;

function normalizeVocabulary(value) {
  if (!Array.isArray(value)) return [];
  const terms = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const term = entry.trim();
    if (term) terms.push(term);
  }
  return terms.slice(0, MAX_TERMS);
}

function deepgramVocabParams(model, terms) {
  const list = normalizeVocabulary(terms);
  if (list.length === 0) return {};
  if (model === 'nova-2') return { keywords: list.map((term) => `${term}:2`) };
  if (model === 'nova-3') return { keyterm: list };
  return {};
}

function speechmaticsVocab(terms) {
  return normalizeVocabulary(terms).map((term) => ({ content: term }));
}

function whisperPrompt(terms) {
  return normalizeVocabulary(terms).join(' ');
}

module.exports = {
  MAX_TERMS,
  normalizeVocabulary,
  deepgramVocabParams,
  speechmaticsVocab,
  whisperPrompt,
};
