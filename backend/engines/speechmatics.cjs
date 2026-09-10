const axios = require('axios');
const { cleanupText } = require('../cleanup.cjs');
const { speechmaticsVocab } = require('../vocabulary.cjs');

const BASE_URL = 'https://eu1.asr.api.speechmatics.com';

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

async function transcribe(apiKey, audioPath, language, signal, polishMode, vocabulary) {
  throwIfAborted(signal);
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Speechmatics API key not set. Please enter your API key in settings.');

  const fs = require('fs');
  const audioBuffer = fs.readFileSync(audioPath);
  debugLog('Speechmatics: audio loaded', { bytes: audioBuffer.length, file: audioPath });

  const lang = language && language !== 'auto' ? language : 'en';
  const transcriptionConfig = { language: lang };
  const additionalVocab = speechmaticsVocab(vocabulary);
  if (additionalVocab.length > 0) transcriptionConfig.additional_vocab = additionalVocab;
  const config = JSON.stringify({
    type: 'transcription',
    transcription_config: transcriptionConfig,
  });

  // Step 1: Submit a batch transcription job
  const FormData = require('form-data');
  const form = new FormData();
  form.append('config', config);
  form.append('data_file', audioBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });

  let jobId;
  try {
    const submitResp = await axios.post(`${BASE_URL}/v2/jobs/`, form, {
      headers: { Authorization: `Bearer ${key}`, ...form.getHeaders() },
      timeout: 60000,
      validateStatus: () => true,
      signal,
    });

    debugLog('Speechmatics: submit response', { status: submitResp.status, data: submitResp.data });

    if (submitResp.status < 200 || submitResp.status >= 300) {
      const detail = submitResp.data?.error?.message || JSON.stringify(submitResp.data);
      throw new Error(`Speechmatics API error (${submitResp.status}): ${detail}`);
    }
    jobId = submitResp.data?.id;
    if (!jobId) throw new Error('Speechmatics did not return a job ID');
    debugLog('Speechmatics: job submitted', { jobId });
  } catch (error) {
    throwIfAborted(signal);
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Speechmatics API error')) throw error;
    throw new Error(`Speechmatics job submission failed: ${message}`);
  }

  // Step 2: Poll until the job completes (max 120s)
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      const statusResp = await axios.get(`${BASE_URL}/v2/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 30000,
        validateStatus: () => true,
        signal,
      });
      debugLog('Speechmatics: status', { jobId, status: statusResp.data?.job?.status });
      const status = statusResp.data?.job?.status;
      if (status === 'done') break;
      if (status === 'rejected') {
        const errMsg = statusResp.data?.job?.error || 'Job was rejected';
        throw new Error(`Speechmatics rejected job: ${errMsg}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.startsWith('Speechmatics rejected')) throw error;
      debugLog('Speechmatics: poll error', { jobId, error: msg });
    }
  }

  // Step 3: Fetch the transcript as plain text
  throwIfAborted(signal);
  try {
    const transcriptResp = await axios.get(`${BASE_URL}/v2/jobs/${jobId}/transcript`, {
      headers: { Authorization: `Bearer ${key}` },
      params: { format: 'txt' },
      timeout: 30000,
      validateStatus: () => true,
      signal,
    });

    debugLog('Speechmatics: transcript response', { status: transcriptResp.status });

    if (transcriptResp.status < 200 || transcriptResp.status >= 300) {
      throw new Error(`Speechmatics transcript fetch failed (${transcriptResp.status})`);
    }

    const text = typeof transcriptResp.data === 'string'
      ? transcriptResp.data.trim()
      : JSON.stringify(transcriptResp.data);

    if (!text) throw new Error('Speechmatics produced an empty transcript');
    throwIfAborted(signal);
    return { text: cleanupText(text, polishMode), detectedLanguage: lang !== 'en' ? lang : null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Speechmatics produced')) throw error;
    throw new Error(`Speechmatics transcript fetch failed: ${message}`);
  }
}

async function testConnection(apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Speechmatics API key not set.');
  try {
    const response = await axios.get(`${BASE_URL}/v2/jobs/`, {
      headers: { Authorization: `Bearer ${key}` },
      params: { wait: 0 },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Invalid API key');
    }
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, message: 'Connection successful' };
    }
    throw new Error(`Unexpected status: ${response.status}`);
  } catch (error) {
    const msg = error?.message || String(error);
    if (msg.includes('Invalid API key')) throw new Error('Speechmatics connection failed: Invalid API key');
    throw new Error(`Speechmatics connection failed: ${msg}`);
  }
}

module.exports = { transcribe, testConnection };
