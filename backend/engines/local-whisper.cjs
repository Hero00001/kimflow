const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { cleanupText } = require('../cleanup.cjs');
const { whisperPrompt } = require('../vocabulary.cjs');
const { CONFIG_DIR } = require('../settings.cjs');
const { validateModelSize, modelFilename } = require('../model-download.cjs');
const { isAbortError } = require('../recorder-decisions.cjs');

const execFileAsync = promisify(execFile);

function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Windows NTSTATUS crash codes that indicate the binary crashed, not a normal error.
const CRASH_EXIT_CODES = new Set([
  0xC0000409, // STATUS_STACK_BUFFER_OVERRUN
  0xC0000005, // STATUS_ACCESS_VIOLATION
  0xC000013A, // STATUS_CONTROL_C_EXIT
  0xC0000135, // STATUS_DLL_NOT_FOUND
  0xC000007B, // STATUS_INVALID_IMAGE_FORMAT
  0xC000042D, // STATUS_VS_BETADISABLED
  0xC000000D, // STATUS_INVALID_PARAMETER
  0xC000001D, // STATUS_ILLEGAL_INSTRUCTION
]);

function isCrashExitCode(code) {
  if (code == null) return false;
  // Node.js on Windows may return the signed 32-bit value
  const signed = code > 0x7FFFFFFF ? code - 0x100000000 : code;
  return CRASH_EXIT_CODES.has(signed >>> 0);
}

function crashErrorMessage(exitCode, stderr) {
  const signed = exitCode > 0x7FFFFFFF ? exitCode - 0x100000000 : exitCode;
  // Compare as unsigned: NTSTATUS literals above are all > 0x7FFFFFFF, so a
  // signed comparison would never match and no hint would ever fire.
  const code = signed >>> 0;
  const hex = '0x' + code.toString(16).toUpperCase();
  const hints = [];

  if (code === 0xC0000409 || code === 0xC0000005) {
    hints.push(
      'The whisper binary crashed (stack overrun / access violation). This is usually caused by:',
      '  1. Incompatible whisper.cpp build — try a different release (e.g. CPU-only or a newer Vulkan build)',
      '  2. Missing VC++ Redistributable — install Microsoft Visual C++ Redistributable (latest)',
      '  3. Model file mismatch — re-download the model in Settings',
      '  4. Try running whisper-cli.exe directly from a terminal to confirm the crash',
    );
  } else if (code === 0xC0000135) {
    hints.push(
      'A required DLL was not found. Install the Vulkan Runtime (vulkan-1.dll) or VC++ Redistributable.',
    );
  } else if (code === 0xC000007B) {
    hints.push(
      'Invalid image format — you may be using a 32-bit whisper binary on a 64-bit system or vice versa.',
    );
  } else if (code === 0xC000001D) {
    hints.push(
      'Illegal instruction — this whisper build was compiled for a newer CPU than this machine has (recent builds need AVX2).',
      '  1. Your GPU and driver are fine — the binary dies before using them, so reinstalling drivers will not help',
      '  2. Use a CPU-only / baseline whisper build instead (runs everywhere, just slower)',
      '  3. Or build whisper.cpp from source on this PC with a portable CPU baseline and Vulkan enabled',
    );
  }

  if (hints.length > 0) {
    return `\n${hints.join('\n')}`;
  }
  return '';
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

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error('Transcription aborted');
    error.name = 'AbortError';
    throw error;
  }
}

async function transcribe(modelSize, audioPath, language, binaryPath, signal, polishMode, vocabulary) {
  throwIfAborted(signal);
  validateModelSize(modelSize);
  const modelPath = path.join(CONFIG_DIR, modelFilename(modelSize));
  if (!fs.existsSync(modelPath)) throw new Error('Whisper model not found. Please download a model first.');

  const whisperBinary = resolveWhisperBinary(binaryPath);
  if (!whisperBinary) {
    throw new Error('Whisper binary not found. Use Select Binary in Settings to locate whisper-cli, or choose a cloud engine.');
  }

  const langFlag = language && language !== 'auto' ? language : 'auto';
  const args = ['-m', modelPath, '-f', audioPath, '--no-timestamps', '-l', langFlag];
  const prompt = whisperPrompt(vocabulary);
  if (prompt) args.push('--prompt', prompt);
  try {
    const { stdout, stderr } = await execFileAsync(whisperBinary, args, { timeout: 120000, windowsHide: true, maxBuffer: 10 * 1024 * 1024, signal });
    throwIfAborted(signal);
    const detectedLanguage = detectedLanguageFromOutput(stderr) || detectedLanguageFromOutput(stdout);
    return { text: cleanupText(stdout.trim(), polishMode), detectedLanguage };
  } catch (error) {
    if (isAbortError(error, signal)) {
      const abortError = new Error('Transcription aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    // Keep the raw whisper output for diagnostics, but surface a friendly single-line message.
    const parts = [`whisper.cpp failed: ${errorText(error)}`];
    if (error.stderr) parts.push(`stderr: ${String(error.stderr).trim()}`);
    if (error.stdout) parts.push(`stdout: ${String(error.stdout).trim()}`);
    if (error.code != null) {
      parts.push(`exit code: ${error.code}`);
      if (isCrashExitCode(error.code)) {
        parts.push(crashErrorMessage(error.code, error.stderr));
      }
    }
    const { friendlyMessageFor } = require('../friendly-errors.cjs');
    const raw = parts.join('\n');
    const friendly = friendlyMessageFor(error) || 'Transcription failed — see details and try again.';
    const out = new Error(friendly); out.details = raw.slice(0, 2000); out.code = error && error.code;
    throw out;
  }
}

module.exports = { transcribe, isCrashExitCode, crashErrorMessage };
