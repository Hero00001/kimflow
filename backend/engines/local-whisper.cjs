const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { cleanupText } = require('../cleanup.cjs');
const { CONFIG_DIR } = require('../settings.cjs');
const { validateModelSize, modelFilename } = require('../model-download.cjs');

const execFileAsync = promisify(execFile);

function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function detectedLanguageFromOutput(output) {
  const text = String(output || '');
  const match = text.match(/detected language[:\s]+([a-z]{2,3})/i) || text.match(/\blanguage[:\s]+([a-z]{2,3})\b/i);
  return match ? match[1].toLowerCase() : null;
}

function resolveWhisperBinary(customPath) {
  const candidates = [
    customPath,
    path.join(CONFIG_DIR, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
    path.join(CONFIG_DIR, process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
    path.join(__dirname, '..', process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
    process.resourcesPath && path.join(process.resourcesPath, 'backend', 'bin', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
    process.resourcesPath && path.join(process.resourcesPath, 'backend', 'bin', process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'bin', process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'bin', process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  }) || null;
}

async function transcribe(modelSize, audioPath, language, binaryPath) {
  validateModelSize(modelSize);
  const modelPath = path.join(CONFIG_DIR, modelFilename(modelSize));
  if (!fs.existsSync(modelPath)) throw new Error('Whisper model not found. Please download a model first.');

  const whisperBinary = resolveWhisperBinary(binaryPath);
  if (!whisperBinary) {
    throw new Error('Whisper binary not found. Use Select Binary in Settings to locate whisper-cli, or choose a cloud engine.');
  }

  const langFlag = language && language !== 'auto' ? language : 'auto';
  try {
    const { stdout, stderr } = await execFileAsync(whisperBinary, [
      '-m', modelPath, '-f', audioPath, '--no-timestamps', '-l', langFlag,
    ], { timeout: 120000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    const detectedLanguage = detectedLanguageFromOutput(stderr) || detectedLanguageFromOutput(stdout);
    return { text: cleanupText(stdout.trim()), detectedLanguage };
  } catch (error) {
    throw new Error(`whisper.cpp failed: ${errorText(error)}`);
  }
}

module.exports = { transcribe };
