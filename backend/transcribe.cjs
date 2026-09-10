/**
 * Transcription orchestrator.
 *
 * Delegates to engine-specific modules and re-exports a stable public API
 * so that callers (recorder.cjs, main.cjs) do not need to know about the
 * internal module split.
 */

const deepgram = require('./engines/deepgram.cjs');
const speechmatics = require('./engines/speechmatics.cjs');
const localWhisper = require('./engines/local-whisper.cjs');
const modelDownload = require('./model-download.cjs');

/* ── Public API (unchanged signatures) ──────────────────────────────── */

async function transcribeDeepgram(apiKey, audioPath, language, model, signal, polishMode) {
  return deepgram.transcribe(apiKey, audioPath, language, model, signal, polishMode);
}

async function transcribeSpeechmatics(apiKey, audioPath, language, signal, polishMode) {
  return speechmatics.transcribe(apiKey, audioPath, language, signal, polishMode);
}

async function transcribeLocal(modelSize, audioPath, language, binaryPath, signal, polishMode) {
  return localWhisper.transcribe(modelSize, audioPath, language, binaryPath, signal, polishMode);
}

async function testDeepgramConnection(apiKey) {
  return deepgram.testConnection(apiKey);
}

async function testSpeechmaticsConnection(apiKey) {
  return speechmatics.testConnection(apiKey);
}

/* ── Re-export model-download helpers ────────────────────────────────── */

const { modelFilename, modelDownloadUrl, modelDownloaded, downloadModel } = modelDownload;

module.exports = {
  transcribeDeepgram,
  transcribeSpeechmatics,
  transcribeLocal,
  testDeepgramConnection,
  testSpeechmaticsConnection,
  modelFilename,
  modelDownloadUrl,
  modelDownloaded,
  downloadModel,
};
