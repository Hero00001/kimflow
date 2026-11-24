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
const sherpa = require('./engines/sherpa.cjs');
const modelDownload = require('./model-download.cjs');

/* ── Public API (unchanged signatures) ──────────────────────────────── */

async function transcribeDeepgram(apiKey, audioPath, language, model, signal, polishMode, vocabulary) {
  return deepgram.transcribe(apiKey, audioPath, language, model, signal, polishMode, vocabulary);
}

async function transcribeSpeechmatics(apiKey, audioPath, language, signal, polishMode, vocabulary) {
  return speechmatics.transcribe(apiKey, audioPath, language, signal, polishMode, vocabulary);
}

async function transcribeLocal(modelSize, audioPath, language, binaryPath, signal, polishMode, vocabulary) {
  return localWhisper.transcribe(modelSize, audioPath, language, binaryPath, signal, polishMode, vocabulary);
}

/**
 * SenseVoice via the sherpa-onnx sidecar. Callers MUST route through
 * resolveSherpaModel first — a `{ fallback: 'whisper-cpp' }` answer means
 * the caller transcribes with transcribeLocal instead.
 */
async function transcribeSherpa(modelId, audioPath, language, signal, polishMode, vocabulary) {
  return sherpa.transcribe(modelId, audioPath, language, signal, polishMode, vocabulary);
}

function resolveSherpaModel(language, storedModel, deps) {
  return sherpa.resolveSherpaModel(language, storedModel, deps);
}

async function testDeepgramConnection(apiKey) {
  return deepgram.testConnection(apiKey);
}

async function testSpeechmaticsConnection(apiKey) {
  return speechmatics.testConnection(apiKey);
}

/* ── Re-export model-download helpers ────────────────────────────────── */

const {
  modelFilename,
  modelDownloadUrl,
  modelDownloaded,
  downloadModel,
  registryHas,
  registryDownloaded,
  downloadRegistryEntry,
} = modelDownload;

module.exports = {
  transcribeDeepgram,
  transcribeSpeechmatics,
  transcribeLocal,
  transcribeSherpa,
  resolveSherpaModel,
  testDeepgramConnection,
  testSpeechmaticsConnection,
  modelFilename,
  modelDownloadUrl,
  modelDownloaded,
  downloadModel,
  registryHas,
  registryDownloaded,
  downloadRegistryEntry,
};
