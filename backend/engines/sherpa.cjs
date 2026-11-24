/**
 * SenseVoice-Small local engine via the sherpa-onnx sidecar.
 *
 * Mirrors the proven whisper sidecar pattern (execFile + timeout +
 * isCrashExitCode triage) and deepgram.cjs's resolver contract:
 * `resolveSherpaModel(language, storedModel, deps)` returns either
 * `{ model, engine: 'sherpa-onnx' }` or `{ fallback: 'whisper-cpp' }`.
 *
 * Routing is deliberately narrow (spec §Locked decisions): ONLY zh/yue/ja/ko
 * dictation reaches SenseVoice, and only when the user chose the sherpa-onnx
 * local engine AND the sidecar + model are present. English and Arabic stay
 * on whisper.cpp — never regress them. `auto` also falls back: SenseVoice
 * covers four languages, and "auto" means "I don't know", which is exactly
 * when the wider whisper model must answer.
 *
 * Vocabulary is accepted for signature symmetry with the other engines but is
 * deliberately NOT passed: SenseVoice has no hotword mechanism (spec: do not
 * fake it).
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { cleanupText } = require('../cleanup.cjs');
const { CONFIG_DIR } = require('../settings.cjs');
const { registryEntry, registryDownloaded, registryModelDir } = require('../model-download.cjs');
const { isCrashExitCode, crashErrorMessage } = require('./local-whisper.cjs');
const { isAbortError } = require('../recorder-decisions.cjs');

const execFileAsync = promisify(execFile);

const SENSE_VOICE_MODEL_ID = 'sense-voice-int8';
const SENSE_VOICE_MODEL_IDS = new Set([SENSE_VOICE_MODEL_ID]);
// SenseVoice-Small's language coverage (spec §Goal). Yue = Cantonese.
const SHERPA_LANGUAGES = new Set(['zh', 'yue', 'ja', 'ko']);

const SHERPA_BINARY_NAME = process.platform === 'win32' ? 'sherpa-onnx-offline.exe' : 'sherpa-onnx-offline';
// Registry ids this engine needs on disk before it can transcribe.
const RUNTIME_ENTRY_ID = 'sherpa-runtime-win-x64';

function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Transcription aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function normalizeLanguage(language) {
  const value = typeof language === 'string' ? language.trim().toLowerCase() : '';
  return value || 'auto';
}

/** Depth-limited recursive search for one file name. Returns null when absent. */
function findFileRecursive(dir, name, depth = 3) {
  if (depth < 0) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, name, depth - 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Locate the sherpa-onnx-offline sidecar.
 *
 * Resolution order (mirrors resolveWhisperBinary's pattern):
 *   1. `KIMFLOW_SHERPA_BIN` env override (tests + advanced setups; the app
 *      deliberately has NO sherpaBinaryPath setting — spec allows exactly
 *      localEngine + sherpaModel).
 *   2. The extracted runtime under CONFIG_DIR/sherpa/ (where the registry
 *      download unpacks the win-x64 runtime archive).
 *   3. The bundled backend/bin sidecar (asar.unpacked layout, whisper-style).
 *
 * @returns {string|null} absolute path to the sidecar, or null when absent.
 */
function resolveSherpaBinary() {
  const override = process.env.KIMFLOW_SHERPA_BIN;
  const candidates = [
    override,
    findFileRecursive(path.join(CONFIG_DIR, 'sherpa'), SHERPA_BINARY_NAME),
    path.join(__dirname, '..', 'bin', SHERPA_BINARY_NAME),
    process.resourcesPath && path.join(process.resourcesPath, 'backend', 'bin', SHERPA_BINARY_NAME),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'bin', SHERPA_BINARY_NAME),
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || null;
}

/** True when BOTH the runtime sidecar and the SenseVoice model are on disk. */
function sherpaReady() {
  return resolveSherpaBinary() !== null && registryDownloaded(SENSE_VOICE_MODEL_ID);
}

/**
 * Route one dictation request.
 *
 * @param {string} language input language code or 'auto'
 * @param {string} storedModel stored sherpaModel setting (registry id)
 * @param {{localEngine?: string, sidecarPresent?: boolean, modelDownloaded?: boolean}} [deps]
 *   injectable overrides for tests; each defaults to the real on-disk check.
 * @returns {{model: string, engine: 'sherpa-onnx'}|{fallback: 'whisper-cpp'}}
 */
function resolveSherpaModel(language, storedModel, deps = {}) {
  const localEngine = deps.localEngine || 'whisper-cpp';
  const lang = normalizeLanguage(language);
  if (localEngine !== 'sherpa-onnx') return { fallback: 'whisper-cpp' };
  if (lang === 'auto' || !SHERPA_LANGUAGES.has(lang)) return { fallback: 'whisper-cpp' };
  const sidecarPresent = deps.sidecarPresent !== undefined ? deps.sidecarPresent : resolveSherpaBinary() !== null;
  const downloaded = deps.modelDownloaded !== undefined ? deps.modelDownloaded : registryDownloaded(SENSE_VOICE_MODEL_ID);
  if (!sidecarPresent || !downloaded) return { fallback: 'whisper-cpp' };
  const model = SENSE_VOICE_MODEL_IDS.has(storedModel) ? storedModel : SENSE_VOICE_MODEL_ID;
  return { model, engine: 'sherpa-onnx' };
}

/**
 * sherpa-onnx-offline prints one JSON object per run (keys include "text").
 * Older builds printed a bare line instead, so fall back to that.
 */
function parseSherpaOutput(stdout) {
  const text = String(stdout || '').trim();
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.text === 'string') return parsed.text.trim();
  } catch { /* not JSON — fall through */ }
  const match = text.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match) return JSON.parse(`"${match[1]}"`).trim();
  return text;
}

/**
 * Transcribe one wav with the sherpa-onnx sidecar.
 *
 * @param {string} modelId registry id (must be a SenseVoice registry entry)
 * @param {string} audioPath wav path
 * @param {string} language input language (unused by SenseVoice — it tags the
 *   detected language in its output; accepted for dispatcher symmetry)
 * @param {AbortSignal} [signal]
 * @param {string} polishMode cleanup mode applied to the transcript
 * @param {string[]} [vocabulary] IGNORED — SenseVoice has no hotword mechanism
 */
async function transcribe(modelId, audioPath, language, signal, polishMode, vocabulary) {
  throwIfAborted(signal);
  const entry = registryEntry(modelId);
  const modelDir = registryModelDir(modelId);
  const modelPath = path.join(modelDir, 'model.int8.onnx');
  const tokensPath = path.join(modelDir, 'tokens.txt');
  if (!fs.existsSync(modelPath) || !fs.existsSync(tokensPath)) {
    const error = new Error('SenseVoice model not found — download it in Settings first.');
    error.details = `expected ${modelPath} and ${tokensPath} (entry ${entry.id})`;
    throw error;
  }

  const sidecar = resolveSherpaBinary();
  if (!sidecar) {
    const error = new Error('SenseVoice sidecar not found — sherpa-onnx-offline is not installed.');
    error.details = `looked in ${CONFIG_DIR}/sherpa, backend/bin and resources paths`;
    throw error;
  }

  // Flags verified against sherpa-onnx v2.0.3 win-x64 --help (ticket 02):
  // --sense-voice-model, --tokens, --sense-voice-language (auto|zh|en|ja|ko|yue).
  // The resolver only routes explicit zh/yue/ja/ko here, so the language flag
  // is always concrete; --sense-voice-use-itn stays at its default (off) and
  // text shaping is owned by the shared cleanup pipeline, like whisper.
  const args = [`--sense-voice-model=${modelPath}`, `--tokens=${tokensPath}`];
  if (language && language !== 'auto') args.push(`--sense-voice-language=${language}`);
  args.push(audioPath);
  // promisified execFile REJECTS signal: null (must be an AbortSignal instance
  // or absent) — the signal is optional, so it is only attached when the
  // caller provides one. Found by the ticket 06 smoke test.
  const options = { timeout: 120000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 };
  if (signal) options.signal = signal;
  try {
    const { stdout } = await execFileAsync(sidecar, args, options);
    throwIfAborted(signal);
    const raw = parseSherpaOutput(stdout);
    return { text: cleanupText(raw, polishMode), detectedLanguage: language && language !== 'auto' ? language : null };
  } catch (error) {
    if (isAbortError(error, signal)) {
      const abortError = new Error('Transcription aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    const parts = [`sherpa-onnx failed: ${errorText(error)}`];
    if (error.stderr) parts.push(`stderr: ${String(error.stderr).trim()}`);
    if (error.stdout) parts.push(`stdout: ${String(error.stdout).trim()}`);
    if (error.code != null) {
      parts.push(`exit code: ${error.code}`);
      if (isCrashExitCode(error.code)) parts.push(crashErrorMessage(error.code, error.stderr));
    }
    const { friendlyMessageFor } = require('../friendly-errors.cjs');
    const rawDetails = parts.join('\n');
    const friendly = friendlyMessageFor(error) || 'Transcription failed — see details and try again.';
    const out = new Error(friendly);
    out.details = rawDetails.slice(0, 2000);
    out.code = error && error.code;
    throw out;
  }
}

module.exports = {
  transcribe,
  resolveSherpaModel,
  resolveSherpaBinary,
  sherpaReady,
  parseSherpaOutput,
  SENSE_VOICE_MODEL_ID,
  SHERPA_LANGUAGES,
  RUNTIME_ENTRY_ID,
};
