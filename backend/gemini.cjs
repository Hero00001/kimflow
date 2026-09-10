const axios = require('axios');
const https = require('https');
const { isKnownLanguage, targetFor } = require('./languages.cjs');

// Keep-alive avoids a fresh TLS handshake on every translation request.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 5 });

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
const inspectedModels = new Map();

function translationError(message) {
  const error = new Error(message);
  error.name = 'TranslationError';
  return error;
}

function normalizeModelId(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;

  const urlMatch = value.match(/^https?:\/\/[^\s]+\/v1(?:beta)?\/models\/([^:?]+)/i);
  if (urlMatch) value = urlMatch[1];

  value = value
    .replace(/^models\//i, '')
    .replace(/^\/+/, '')
    .replace(/:\w+\s*$/, '')
    .split(/[/?#]/)[0]
    .trim();

  if (!value || !/^[A-Za-z0-9._-]+$/.test(value)) return null;
  return value;
}

async function inspectModel(apiKey, modelId) {
  const key = String(apiKey || '').trim();
  const normalized = normalizeModelId(modelId);
  if (!normalized) return { found: false, methods: [], error: 'Invalid model id' };

  const cacheKey = `${key}|${normalized}`;
  if (inspectedModels.has(cacheKey)) return inspectedModels.get(cacheKey);

  let result;
  try {
    const response = await axios.get(`${API_BASE}/models/${encodeURIComponent(normalized)}`, {
      params: { key },
      timeout: 15000,
      httpsAgent: keepAliveAgent,
      validateStatus: () => true,
    });
    if (response.status === 404) {
      result = { found: false, methods: [], error: 'not_found' };
    } else if (response.status < 200 || response.status >= 300) {
      const detail = describeError(response.data) || String(response.data || '');
      result = { found: false, methods: [], error: `http_${response.status}`, detail };
    } else {
      result = {
        found: true,
        methods: Array.isArray(response.data?.supportedGenerationMethods)
          ? response.data.supportedGenerationMethods
          : [],
        displayName: typeof response.data?.displayName === 'string' ? response.data.displayName : '',
      };
    }
  } catch (error) {
    result = { found: false, methods: [], error: 'network' };
  }
  inspectedModels.set(cacheKey, result);
  return result;
}

function textModelList() {
  return MODEL_PREFERENCE.slice(0, 4).join(', ');
}

async function validateModel(apiKey, modelId) {
  const key = String(apiKey || '').trim();
  const raw = String(modelId || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const normalized = normalizeModelId(raw);
  if (!normalized) {
    return {
      ok: false,
      found: false,
      message: `Invalid model id "${raw}". Use the short id (e.g. gemini-3.6-flash) without "models/", slashes, or a URL.`,
    };
  }

  let info;
  try {
    info = await inspectModel(key, normalized);
  } catch {
    info = { found: false, methods: [], error: 'network' };
  }

  if (!info.found) {
    return {
      ok: false,
      found: false,
      model: normalized,
      message: `Gemini model "${normalized}" was not found for this API key. Current text models include ${textModelList()}, or leave the Gemini Model field empty for automatic selection.`,
    };
  }

  const supports = Array.isArray(info.methods) && info.methods.includes('generateContent');
  if (!supports) {
    return {
      ok: false,
      found: true,
      supportsGenerateContent: false,
      methods: info.methods,
      model: normalized,
      message: `Gemini model "${normalized}" (${info.displayName || 'available'}) does not support text generation (generateContent). It supports: ${info.methods.join(', ') || 'none'}. Live-translate models are audio-only. Use a text model such as gemini-3.6-flash or leave the field for automatic selection.`,
    };
  }

  return {
    ok: true,
    found: true,
    supportsGenerateContent: true,
    methods: info.methods,
    model: normalized,
    message: `${normalized} supports text generation.`,
  };
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

function buildPolishPrompt(text, language) {
  const languageLabel = !language || language === 'auto'
    ? 'the same language as the transcript'
    : `the language "${targetFor(language)}"`;
  return [
    'You are a dictation cleanup engine.',
    `Rewrite the transcript below into clean written text in ${languageLabel}.`,
    'Remove filler words, false starts and repeated words.',
    'Resolve self-corrections, keeping only the final intent.',
    'Fix grammar and punctuation. Keep names, numbers and meaning exactly.',
    'Return ONLY the rewritten text as plain text.',
    'Do not add explanations, notes or quotes.',
    'If the text is already clean, return it unchanged.',
    '',
    text,
  ].join('\n');
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
      httpsAgent: keepAliveAgent,
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

  const rawModel = String(model || '').trim();
  let activeModel;
  if (rawModel) {
    const validation = await validateModel(key, rawModel);
    if (!validation.ok) throw translationError(validation.message);
    activeModel = validation.model;
  } else {
    activeModel = await resolveModel(key);
  }
  const endpoint = `${API_BASE}/models/${encodeURIComponent(activeModel)}:generateContent`;
  let response;
  try {
    response = await axios.post(endpoint, {
      contents: [{ role: 'user', parts: [{ text: buildPrompt(trimmed, sourceLanguage, targetLanguage) }] }],
      // Low-latency tuning: deterministic output, bounded length, plain text.
      generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'text/plain' },
    }, {
      params: { key },
      timeout: TIMEOUT_MS,
      httpsAgent: keepAliveAgent,
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

async function polish({ text, language, apiKey, model }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const key = String(apiKey || '').trim();
  if (!key) throw translationError('Gemini API key not set. Please enter your API key in settings.');
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw translationError('Transcript is too long to polish in one request.');
  }

  const rawModel = String(model || '').trim();
  let activeModel;
  if (rawModel) {
    const validation = await validateModel(key, rawModel);
    if (!validation.ok) throw translationError(validation.message);
    activeModel = validation.model;
  } else {
    activeModel = await resolveModel(key);
  }
  const endpoint = `${API_BASE}/models/${encodeURIComponent(activeModel)}:generateContent`;
  let response;
  try {
    response = await axios.post(endpoint, {
      contents: [{ role: 'user', parts: [{ text: buildPolishPrompt(trimmed, language) }] }],
      // Polish runs once per transcript on short text: deterministic,
      // tightly bounded output keeps free-tier usage negligible.
      generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'text/plain' },
    }, {
      params: { key },
      timeout: TIMEOUT_MS,
      httpsAgent: keepAliveAgent,
      validateStatus: () => true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw translationError(`Gemini API request failed: ${message}`);
  }

  if (response.status < 200 || response.status >= 300) {
    const detail = describeError(response.data);
    throw translationError(
      detail
        ? `Gemini API error (${response.status}): ${detail}`
        : `Gemini API error (${response.status})`,
    );
  }

  const polished = extractText(response.data);
  if (polished === null) throw translationError('Gemini returned no polished text.');
  return stripFences(polished);
}

// Best-effort pre-resolution so the model lookup can run in parallel with
// transcription (or at app start) instead of adding a round-trip on stop.
async function warmup(apiKey, model) {
  try {
    const raw = String(model || '').trim();
    if (raw) await inspectModel(String(apiKey || '').trim(), raw);
    else await resolveModel(apiKey);
  } catch {
    // Warmup must never break recording/transcription.
  }
}

module.exports = {
  PROVIDER_NAME,
  DEFAULT_MODEL,
  MODEL_PREFERENCE,
  translate,
  polish,
  buildPolishPrompt,
  resolveModel,
  validateModel,
  inspectModel,
  normalizeModelId,
  warmup,
};