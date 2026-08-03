const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { cleanupText } = require('./cleanup.cjs');
const { CONFIG_DIR } = require('./settings.cjs');

const execFileAsync = promisify(execFile);
const ALLOWED_MODELS = new Set(['small', 'medium']);

function errorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function validateModelSize(modelSize) {
  if (!ALLOWED_MODELS.has(modelSize)) {
    throw new Error(`Unsupported Whisper model: ${modelSize}`);
  }
  return modelSize;
}

async function transcribeDeepgram(apiKey, audioPath) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Deepgram API key not set. Please enter your API key in settings.');

  const audioBuffer = fs.readFileSync(audioPath);
  const { createClient } = require('@deepgram/sdk');
  const deepgram = createClient(key);
  const response = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
    model: 'nova-2',
    language: 'en',
    smart_format: true,
    mimetype: 'audio/wav',
  });

  if (response?.error) {
    throw new Error(`Deepgram error: ${response.error.message || response.error}`);
  }
  const transcript = response?.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript) throw new Error('No transcription result from Deepgram');
  return cleanupText(transcript);
}

async function transcribeGroq(apiKey, audioPath) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Groq API key not set. Please enter your API key in settings.');

  const FormData = require('form-data');
  const form = new FormData();
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('response_format', 'json');
  form.append('file', fs.createReadStream(audioPath), {
    filename: 'audio.wav',
    contentType: 'audio/wav',
  });

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: { Authorization: `Bearer ${key}`, ...form.getHeaders() },
        maxBodyLength: Infinity,
        timeout: 120000,
        validateStatus: () => true,
      },
    );
    if (response.status < 200 || response.status >= 300) {
      const detail = response.data?.error?.message || JSON.stringify(response.data);
      throw new Error(`Groq API error (${response.status}): ${detail}`);
    }
    const text = response.data?.text;
    if (typeof text !== 'string' || !text.trim()) throw new Error('No transcription result from Groq');
    return cleanupText(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Groq API error') || message.startsWith('No transcription')) throw error;
    throw new Error(`Groq API request failed: ${message}`);
  }
}

async function transcribeLocal(modelSize, audioPath) {
  validateModelSize(modelSize);
  const modelPath = path.join(CONFIG_DIR, modelFilename(modelSize));
  if (!fs.existsSync(modelPath)) throw new Error('Whisper model not found. Please download a model first.');

  const candidates = [
    path.join(CONFIG_DIR, process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
    path.join(__dirname, process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
    process.resourcesPath && path.join(process.resourcesPath, 'backend', 'bin', process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
    process.resourcesPath && path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'bin', process.platform === 'win32' ? 'whisper-cpp.exe' : 'whisper-cpp'),
  ].filter(Boolean);
  const whisperBinary = candidates.find((candidate) => fs.existsSync(candidate));
  if (!whisperBinary) {
    throw new Error('Whisper binary not found. Add whisper-cpp to the app backend or choose a cloud engine.');
  }

  try {
    const { stdout } = await execFileAsync(whisperBinary, [
      '-m', modelPath, '-f', audioPath, '--no-timestamps', '-l', 'en',
    ], { timeout: 120000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    return cleanupText(stdout.trim());
  } catch (error) {
    throw new Error(`whisper.cpp failed: ${errorText(error)}`);
  }
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
  const tempDest = `${dest}.download`;
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
    fs.renameSync(tempDest, dest);
  } catch (error) {
    try { fs.unlinkSync(tempDest); } catch { /* partial download cleanup */ }
    throw error;
  }
}

module.exports = {
  transcribeDeepgram,
  transcribeGroq,
  transcribeLocal,
  modelFilename,
  modelDownloadUrl,
  modelDownloaded,
  downloadModel,
};
