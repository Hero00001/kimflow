const fs = require('fs');
const { cleanupText } = require('../cleanup.cjs');
const { deepgramVocabParams } = require('../vocabulary.cjs');

const DEEPGRAM_MODELS = {
  'nova-3': { label: 'Nova 3', value: 'nova-3' },
  'nova-2': { label: 'Nova 2', value: 'nova-2' },
  'whisper': { label: 'Whisper (Cloud)', value: 'whisper' },
};

function debugLog(message, payload) {
  if (process.env.KIMFLOW_DEBUG !== '1') return;
  if (typeof payload === 'object') {
    console.log(`[KimFlow] ${message}`, JSON.stringify(payload, null, 2));
  } else {
    console.log(`[KimFlow] ${message}`, payload);
  }
}

function deepgramLanguage(language) {
  return !language || language === 'auto' ? 'multi' : language;
}

function deepgramOptions(language, model) {
  const modelName = DEEPGRAM_MODELS[model] ? model : 'nova-3';
  return { model: modelName, language: deepgramLanguage(language), smart_format: true, numerals: true };
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
  const options = { ...deepgramOptions(language, model), ...deepgramVocabParams(model, vocabulary) };

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
    response = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, options);
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
  const requestedLanguage = options.language;
  const detectedLanguage = alternative?.languages?.[0]
    || channel?.detected_language
    || channel?.detectedLanguage
    || null;

  if (!transcript) {
    const diagnostics = {
      requestedLanguage,
      detectedLanguage,
      audioDurationSeconds: metadata.duration ?? null,
      channels: result?.results?.channels?.length ?? 0,
      alternatives: channel?.alternatives?.length ?? 0,
      words: alternative?.words?.length ?? 0,
      url: query.toString(),
    };
    debugLog('Deepgram: empty transcript', diagnostics);
    const hint = requestedLanguage === 'multi'
      ? 'Deepgram found no speech in its multilingual set. If a specific input language is selected, try setting Input Language to Auto Detect so matched-language speech can be transcribed.'
      : `Deepgram found no speech in the requested language "${requestedLanguage}". If you are speaking a different language, set Input Language to Auto Detect so KimFlow asks Deepgram to transcribe multilingual audio.`;
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

module.exports = { transcribe, testConnection, deepgramOptions };
