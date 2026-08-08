const axios = require('axios');
const { isKnownLanguage, targetFor } = require('./languages.cjs');

const PROVIDER_NAME = 'gemini';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const MODEL_PREFERENCE = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];
const TIMEOUT_MS = 30000;
const MAX_TEXT_LENGTH = 40000;
const resolvedModels = new Map();

function translationError(message) {
  const error = new Error(message);
  error.name = 'TranslationError';
  return error;
}

function buildPrompt(text, sourceLanguage, targetLanguage) {
  const sourceLabel = !sourceLanguage || sourceLanguage === 'auto'
    ? 'its original language'
    : `the language "${targetFor(sourceLanguage)}"`;
  const targetLabel = targetFor(targetLanguage);
  return [
    'You are a professional translation engine.',
    `Translate the text below ${sourceLabel} into ${targetLabel}.`,
    'Return ONLY the translation as plain text.',
    'Do not add explanations, notes, quotes, or the original text.',
    'If the text is empty, return an empty string.',
    '',
    text,
  ].join('\n');
}

function stripFences(text) {
  return text.replace(/^```[a-zA-Z]*\s*/m, '').replace(/```\s*$/m, '').trim();
}

function extractText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((part) => part?.text || '').join('').trim();
    if (text) return text;
  }
  if (typeof data?.error?.message === 'string') {
    throw translationError(`Gemini API error: ${data.error.message}`);
  }
  return null;
}

function describeError(data) {
  const error = data?.error;
  if (!error || typeof error !== 'object') return '';
  const bits = [];
  if (typeof error.code === 'number') bits.push(`code ${error.code}`);
  if (typeof error.status === 'string') bits.push(error.status);
  if (typeof error.message === 'string') bits.push(error.message);
  return bits.join(' — ');
}

async function resolveModel(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return DEFAULT_MODEL;
  if (resolvedModels.has(key)) return resolvedModels.get(key);

  let model = DEFAULT_MODEL;
  try {
    const response = await axios.get(`${API_BASE}/models`, {
      params: { key },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300 && Array.isArray(response.data?.models)) {
      const available = new Set(response.data.models
        .filter((entry) => Array.isArray(entry?.supportedGenerationMethods)
          && entry.supportedGenerationMethods.includes('generateContent'))
        .map((entry) => String(entry.name || '').replace(/^models\//, '')));
      const match = MODEL_PREFERENCE.find((candidate) => available.has(candidate));
      if (match) model = match;
    }
  } catch {
    // Model discovery is best-effort; fall back to the default model.
  }
  resolvedModels.set(key, model);
  return model;
}

async function translate({ text, sourceLanguage, targetLanguage, apiKey, model }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const key = String(apiKey || '').trim();
  if (!key) throw translationError('Gemini API key not set. Please enter your API key in settings.');
  if (!isKnownLanguage(targetLanguage)) {
    throw translationError(`Unsupported target language: ${targetLanguage}`);
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw translationError('Transcript is too long to translate in one request.');
  }

  const activeModel = String(model || '').trim() || await resolveModel(key);
  const endpoint = `${API_BASE}/models/${encodeURIComponent(activeModel)}:generateContent`;
  let response;
  try {
    response = await axios.post(endpoint, {
      contents: [{ role: 'user', parts: [{ text: buildPrompt(trimmed, sourceLanguage, targetLanguage) }] }],
    }, {
      params: { key },
      timeout: TIMEOUT_MS,
      validateStatus: () => true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw translationError(`Gemini API request failed: ${message}`);
  }

  if (response.status < 200 || response.status >= 300) {
    const detail = describeError(response.data);
    console.error('[KimFlow] Gemini API error', JSON.stringify({
      status: response.status,
      model: activeModel,
      url: endpoint.replace(/=([^&=]+)$/, '=[REDACTED]'),
      body: detail || JSON.stringify(response.data),
    }));
    throw translationError(
      detail
        ? `Gemini API error (${response.status}): ${detail}`
        : `Gemini API error (${response.status})`,
    );
  }

  const translated = extractText(response.data);
  if (translated === null) throw translationError('Gemini returned no translation.');
  return stripFences(translated);
}

module.exports = {
  PROVIDER_NAME,
  DEFAULT_MODEL,
  MODEL_PREFERENCE,
  translate,
  resolveModel,
};