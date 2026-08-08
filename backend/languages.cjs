const AUTO = 'auto';

const LANGUAGES = {
  auto: 'Auto Detect',
  en: 'English',
  ar: 'Arabic',
  zh: 'Chinese (Mandarin)',
  ja: 'Japanese',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ko: 'Korean',
  hi: 'Hindi',
  nl: 'Dutch',
  tr: 'Turkish',
  pl: 'Polish',
  vi: 'Vietnamese',
  th: 'Thai',
  uk: 'Ukrainian',
  sv: 'Swedish',
  id: 'Indonesian',
  he: 'Hebrew',
  el: 'Greek',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  da: 'Danish',
  fi: 'Finnish',
  no: 'Norwegian',
};

function isKnownLanguage(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(LANGUAGES, code);
}

function labelFor(code) {
  return isKnownLanguage(code) ? LANGUAGES[code] : String(code || '');
}

function inputLanguages() {
  return Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }));
}

function targetLanguages() {
  return Object.entries(LANGUAGES).filter(([value]) => value !== AUTO)
    .map(([value, label]) => ({ value, label }));
}

module.exports = {
  AUTO,
  LANGUAGES,
  isKnownLanguage,
  inputFor: labelFor,
  targetFor: labelFor,
  inputLanguages,
  targetLanguages,
};