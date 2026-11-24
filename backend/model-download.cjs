const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { CONFIG_DIR } = require('./settings.cjs');

const execFileAsync = promisify(execFile);

const ALLOWED_MODELS = new Set(['tiny', 'base', 'small', 'medium']);

// ── Download registry (sensevoice ticket 03) ────────────────────────────────
//
// id → download + verification + on-disk layout. The whisper ggml models
// predate the registry and keep their dedicated helpers below; new entries
// (SenseVoice model, sherpa-onnx runtime) live here.
//
// `extractDir` is relative to CONFIG_DIR. `requiredFiles` are basenames that
// must exist ANYWHERE under extractDir after extraction (the GitHub archives
// nest a top-level version directory, and the runtime moves DLLs into lib/).
// `bytes`/`sha256` are the EXACT published asset figures — a mismatch rejects
// the download (corrupt/truncated → retriable), never a silently broken model.
const MODEL_REGISTRY = {
  'sense-voice-int8': {
    id: 'sense-voice-int8',
    engine: 'sherpa-onnx',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    filename: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2',
    // sha256 + bytes verified by downloading the published asset (ticket 06
    // smoke test, 2026-11-24).
    sha256: '7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e',
    bytes: 163002883,
    extractDir: path.join('sherpa-model', 'sense-voice-int8'),
    requiredFiles: ['model.int8.onnx', 'tokens.txt'],
  },
  'sherpa-runtime-win-x64': {
    id: 'sherpa-runtime-win-x64',
    engine: 'sherpa-runtime',
    url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.3/sherpa-onnx-v2.0.3-win-x64-shared-MT-Release-no-tts.tar.bz2',
    filename: 'sherpa-onnx-v2.0.3-win-x64-shared-MT-Release-no-tts.tar.bz2',
    // sha256 + bytes verified by downloading the published asset (ticket 06
    // smoke test, 2026-11-24).
    sha256: 'e1536db1fcd1dde829f3cf26dfdbf60909aee6984983f6cd16b03b1352ac43fc',
    bytes: 30850705,
    extractDir: 'sherpa',
    requiredFiles: [process.platform === 'win32' ? 'sherpa-onnx-offline.exe' : 'sherpa-onnx-offline'],
  },
};

function registryEntry(id) {
  const entry = MODEL_REGISTRY[id];
  if (!entry) throw new Error(`Unknown registry entry: ${id}`);
  return entry;
}

function registryHas(id) {
  return Object.prototype.hasOwnProperty.call(MODEL_REGISTRY, id);
}

function registryModelDir(id) {
  return path.join(CONFIG_DIR, registryEntry(id).extractDir);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Depth-limited recursive basename search (archive top-level dirs vary). */
function findFileRecursive(dir, name, depth = 4) {
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

function registryDownloaded(id) {
  const entry = registryEntry(id);
  const root = path.join(CONFIG_DIR, entry.extractDir);
  return entry.requiredFiles.every((name) => findFileRecursive(root, name) !== null);
}

/**
 * Extract a .tar.bz2 with the OS bsdtar (Windows ships one; no new npm
 * dependency).
 *
 * Atomic (QA fix 2026-11-24): the archive is unpacked into a UNIQUE sibling
 * staging dir first, and only a COMPLETE extraction replaces the target
 * (rmSync target + renameSync staging → target). The old wipe-first order
 * destroyed a good install whenever a re-extraction failed, contradicting
 * downloadRegistryEntry's "leaves the previous extraction untouched" promise.
 * On any failure the staging dir is cleaned up and the previous extraction
 * is left exactly as it was.
 */
async function extractTarBz2(archivePath, targetDir) {
  const stagingDir = `${targetDir}.extract-${crypto.randomUUID()}`;
  let result;
  try {
    fs.mkdirSync(stagingDir, { recursive: true });
    result = await execFileAsync('tar', ['-xjf', archivePath, '-C', stagingDir], {
      timeout: 300000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    // Replace only after a complete extraction: the failure window is now a
    // rename, not a re-extraction.
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, targetDir);
  } catch (error) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    throw error;
  }
  return result;
}

/**
 * Download one registry entry: stream to a unique temp file, verify the
 * advertised byte count AND the pinned sha256, extract, then require the
 * entry's files to exist. Any failure cleans the temp file and leaves the
 * previous extraction untouched (corrupt download is retriable).
 * Progress rides the existing single 'download-progress' channel (kind
 * 'model'), same as the whisper ggml flow.
 */
async function downloadRegistryEntry(mainWindow, id) {
  const entry = registryEntry(id);
  const dest = path.join(CONFIG_DIR, entry.filename);
  const tempDest = `${dest}.download-${crypto.randomUUID()}`;
  const targetDir = registryModelDir(id);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  try {
    const response = await axios.get(entry.url, {
      responseType: 'stream',
      timeout: 120000,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Model download failed with status ${response.status}`);
    }

    const total = Number(response.headers['content-length']) || entry.bytes || 0;
    let downloaded = 0;
    const writer = fs.createWriteStream(tempDest);
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          kind: 'model',
          downloaded, total, percent: total ? (downloaded / total) * 100 : 0,
        });
      }
    });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
    if (total > 0 && downloaded !== total) {
      throw new Error(`Model download incomplete: received ${downloaded} of ${total} bytes`);
    }

    // Verify the pinned digest BEFORE anything goes live: a corrupt or
    // truncated archive must never be extracted into the app-data dir.
    const digest = await sha256File(tempDest);
    if (digest !== entry.sha256) {
      throw new Error(`Model download failed verification (sha256 mismatch): expected ${entry.sha256}, got ${digest}`);
    }

    await extractTarBz2(tempDest, targetDir);

    const missing = entry.requiredFiles.filter((name) => findFileRecursive(targetDir, name) === null);
    if (missing.length > 0) {
      throw new Error(`Extracted archive is missing required files: ${missing.join(', ')}`);
    }
  } catch (error) {
    try { fs.unlinkSync(tempDest); } catch { /* partial download cleanup */ }
    throw error;
  } finally {
    // The archive itself is not needed after a successful extraction.
    try { fs.unlinkSync(tempDest); } catch { /* already removed by the catch path */ }
  }
}

function validateModelSize(modelSize) {
  if (!ALLOWED_MODELS.has(modelSize)) {
    throw new Error(`Unsupported Whisper model: ${modelSize}`);
  }
  return modelSize;
}

function modelFilename(modelSize) {
  return `ggml-${validateModelSize(modelSize)}.bin`;
}

function modelDownloadUrl(modelSize) {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFilename(modelSize)}`;
}

function modelDownloaded(modelSize) {
  try {
    return fs.existsSync(path.join(CONFIG_DIR, modelFilename(modelSize)));
  } catch {
    return false;
  }
}

async function downloadModel(mainWindow, modelSize) {
  const modelFile = modelFilename(modelSize);
  const dest = path.join(CONFIG_DIR, modelFile);
  // Unique temp per download: two concurrent downloads of the same model
  // must not share (and corrupt) one staging file.
  const tempDest = `${dest}.download-${crypto.randomUUID()}`;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });

  try {
    const response = await axios.get(modelDownloadUrl(modelSize), {
      responseType: 'stream',
      timeout: 120000,
      validateStatus: () => true,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Model download failed with status ${response.status}`);
    }

    const total = Number(response.headers['content-length']) || 0;
    let downloaded = 0;
    const writer = fs.createWriteStream(tempDest);
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          kind: 'model',
          downloaded, total, percent: total ? (downloaded / total) * 100 : 0,
        });
      }
    });
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
    // A stream can end cleanly early (dropped connection the server never
    // reported). Promote to a model only the exact advertised bytes.
    if (total > 0 && downloaded !== total) {
      throw new Error(`Model download incomplete: received ${downloaded} of ${total} bytes`);
    }
    fs.renameSync(tempDest, dest);
  } catch (error) {
    try { fs.unlinkSync(tempDest); } catch { /* partial download cleanup */ }
    throw error;
  }
}

module.exports = {
  validateModelSize,
  modelFilename,
  modelDownloadUrl,
  modelDownloaded,
  downloadModel,
  MODEL_REGISTRY,
  registryEntry,
  registryHas,
  registryModelDir,
  registryDownloaded,
  downloadRegistryEntry,
  extractTarBz2,
  findFileRecursive,
};
