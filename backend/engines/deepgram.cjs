const fs = require('fs');
const { cleanupText } = require('../cleanup.cjs');
const { deepgramVocabParams } = require('../vocabulary.cjs');
const { awaitAbortable } = require('../recorder-decisions.cjs');

const DEEPGRAM_MODELS = {
  'nova-3': { label: 'Nova 3', value: 'nova-3' },
  'nova-2': { label: 'Nova 2', value: 'nova-2' },
};

// Languages Nova 3 can transcribe as a single language (Deepgram docs).
// A request for any other specific language must go to nova-2, whose
// single-language coverage is far wider.
const NOVA3_LANGUAGES = new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'hi', 'ru', 'ja', 'nl']);

function normalizeLanguage(language) {
  const value = typeof language === 'string' ? language.trim().toLowerCase() : '';
  return value || 'auto';
}

/**
 * The request language config for a concrete model.
 *
 * nova-3 has no true auto-detect: its multilingual mode is `language: multi`.
 * nova-2 MUST NOT be given `language=multi` (that combo fails or produces
 * garbage) — its auto mode is `detect_language: true`.
 */
function languageConfig(language, model) {
  const lang = normalizeLanguage(language);
  if (lang === 'auto') {
    return model === 'nova-2' ? { detect_language: true } : { language: 'multi' };
  }
  return { language: lang };
}

/**
 * Resolve the settings model + input language into the ACTUAL request model
 * and language config.
 *
 * - 'nova-3' / 'nova-2' are honoured as chosen (language config adapts).
 * - Anything else — the default 'auto', or the legacy removed 'whisper' —
 *   falls back smartly: nova-3 with `multi` for auto-detect; nova-3 for a
 *   language it supports; nova-2 otherwise.
 *
 * @param {string} language input language code or 'auto'
 * @param {string} model stored model setting
 * @returns {{model: string, language?: string, detect_language?: boolean}}
 */
function resolveDeepgramModel(language, model) {
  if (model === 'nova-3' || model === 'nova-2') {
    return { model, ...languageConfig(language, model) };
  }
  const lang = normalizeLanguage(language);
  if (lang === 'auto') return { model: 'nova-3', ...languageConfig(lang, 'nova-3') };
  if (NOVA3_LANGUAGES.has(lang)) return { model: 'nova-3', language: lang };
  return { model: 'nova-2', language: lang };
}

function deepgramOptions(language, model) {
  return { ...resolveDeepgramModel(language, model), smart_format: true, numerals: true };
}

function debugLog(message, payload) {
  if (process.env.KIMFLOW_DEBUG !== '1') return;
  if (typeof payload === 'object') {
    console.log(`[KimFlow] ${message}`, JSON.stringify(payload, null, 2));
  } else {
    console.log(`[KimFlow] ${message}`, payload);
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Transcription aborted');
    error.name = 'AbortError';
    throw error;
  }
}

async function transcribe(apiKey, audioPath, language, model, signal, polishMode, vocabulary) {
  throwIfAborted(signal);
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Deepgram API key not set. Please enter your API key in settings.');

  const audioBuffer = fs.readFileSync(audioPath);
  debugLog('Deepgram: audio loaded', { bytes: audioBuffer.length, file: audioPath });
  const { createClient } = require('@deepgram/sdk');
  const deepgram = createClient(key);
  // Vocabulary params key off the RESOLVED model ('nova-2' vs 'nova-3' use
  // different request params), not the raw stored setting.
  const resolved = resolveDeepgramModel(language, model);
  const options = { ...deepgramOptions(language, model), ...deepgramVocabParams(resolved.model, vocabulary) };

  const query = new URL('https://api.deepgram.com/v1/listen');
  for (const keyName of Object.keys(options)) {
    const value = options[keyName];
    if (Array.isArray(value)) {
      for (const entry of value) query.searchParams.append(keyName, String(entry));
    } else {
      query.searchParams.append(keyName, String(value));
    }
  }
  debugLog('Deepgram: request URL', query.toString());

  let response;
  try {
    response = await awaitAbortable(deepgram.listen.prerecorded.transcribeFile(audioBuffer, options), signal);
  } catch (error) {
    throwIfAborted(signal);
    throw new Error(`Deepgram request failed: ${error?.message || error}`);
  }
  throwIfAborted(signal);
  debugLog('Deepgram: response received', response?.result ? {
    duration: response.result?.metadata?.duration,
    channels: response.result?.metadata?.channels,
    models: response.result?.metadata?.models,
    warnings: response.result?.metadata?.warnings,
    error: response?.error?.message || response?.error,
  } : response);

  if (response?.error) {
    throw new Error(`Deepgram error: ${response.error.message || response.error}`);
  }

  const result = response?.result;
  const metadata = result?.metadata || {};
  const channel = result?.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const transcript = typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '';
  // nova-2 auto-detect sends `detect_language` instead of `language`, so the
  // requested language can be absent from the options.
  const requestedLanguage = typeof options.language === 'string' ? options.language : null;
  const detectedLanguage = alternative?.languages?.[0]
    || channel?.detected_language
    || channel?.detectedLanguage
    || null;

  if (!transcript) {
    const diagnostics = {
      requestedLanguage,
      detectedLanguage,
      resolvedModel: resolved.model,
      audioDurationSeconds: metadata.duration ?? null,
      channels: result?.results?.channels?.length ?? 0,
      alternatives: channel?.alternatives?.length ?? 0,
      words: alternative?.words?.length ?? 0,
      url: query.toString(),
    };
    debugLog('Deepgram: empty transcript', diagnostics);
    const hint = requestedLanguage === 'multi'
      ? 'Deepgram found no speech in its multilingual set. If a specific input language is selected, try setting Input Language to Auto Detect so matched-language speech can be transcribed.'
      : requestedLanguage
        ? `Deepgram found no speech for language "${requestedLanguage}" on ${resolved.model}. If you are speaking a different language, set Input Language to Auto Detect so KimFlow asks Deepgram to transcribe multilingual audio.`
        : `Deepgram language detection on ${resolved.model} found no speech. Check that the recording contains audible speech, or set Input Language to a specific language.`;
    throw new Error(`Deepgram produced no transcript${metadata.duration ? ` (audio length ${metadata.duration.toFixed(1)}s)` : ''}. ${hint}`);
  }

  debugLog('Deepgram: transcript parsed', {
    detectedLanguage,
    words: alternative?.words?.length ?? 0,
    length: transcript.length,
  });
  return { text: cleanupText(transcript, polishMode), detectedLanguage };
}

async function testConnection(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Deepgram API key not set.');
  const { createClient } = require('@deepgram/sdk');
  const deepgram = createClient(key);
  try {
    const response = await deepgram.manage.getProjects();
    if (response.error) throw new Error(response.error.message || 'Invalid API key');
    return { ok: true, message: 'Connection successful' };
  } catch (error) {
    const msg = error?.message || String(error);
    throw new Error(`Deepgram connection failed: ${msg}`);
  }
}

module.exports = { transcribe, testConnection, deepgramOptions, resolveDeepgramModel, languageConfig, DEEPGRAM_MODELS, NOVA3_LANGUAGES };
