const gemini = require('./gemini.cjs');

const PROVIDERS = { [gemini.PROVIDER_NAME]: gemini };
const CACHE_SIZE = 30;
const cache = new Map();

function cacheKey(sourceLanguage, targetLanguage, text) {
  return `${String(sourceLanguage || 'auto')}|${String(targetLanguage || '')}|${text}`;
}

function pruneCache() {
  while (cache.size > CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

async function translate({ text, sourceLanguage, targetLanguage, provider: providerName, apiKey, model }) {  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const provider = PROVIDERS[String(providerName || '').toLowerCase()] || PROVIDERS[gemini.PROVIDER_NAME];
  const key = cacheKey(sourceLanguage, targetLanguage, trimmed);

  if (cache.has(key)) {
    const cached = cache.get(key);
    if (cached && !(cached instanceof Error)) return cached;
    cache.delete(key);
  }

  const request = provider.translate({ text: trimmed, sourceLanguage, targetLanguage, apiKey, model });
  cache.set(key, request);
  try {
    const result = await request;
    cache.set(key, result);
    pruneCache();
    return result;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function warmup({ apiKey, model, provider: providerName } = {}) {
  try {
    const provider = PROVIDERS[String(providerName || '').toLowerCase()] || PROVIDERS[gemini.PROVIDER_NAME];
    if (typeof provider.warmup === 'function') await provider.warmup(apiKey, model);
  } catch {
    // Best-effort only.
  }
}

async function polish({ text, language, provider: providerName, apiKey, model }) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';

  const provider = PROVIDERS[String(providerName || '').toLowerCase()] || PROVIDERS[gemini.PROVIDER_NAME];
  if (typeof provider.polish !== 'function') return trimmed;
  const key = `__polish|${String(language || 'auto')}|${trimmed}`;

  if (cache.has(key)) {
    const cached = cache.get(key);
    if (cached && !(cached instanceof Error)) return cached;
    cache.delete(key);
  }

  const request = provider.polish({ text: trimmed, language, apiKey, model });
  cache.set(key, request);
  try {
    const result = await request;
    cache.set(key, result);
    pruneCache();
    return result;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

module.exports = {
  translate,
  polish,
  warmup,
  supportedProviders: () => Object.keys(PROVIDERS),
};