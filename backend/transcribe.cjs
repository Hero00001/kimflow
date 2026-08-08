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

function languageOptions(language) {
  return language && language !== 'auto' ? { language } : {};
}

function deepgramLanguage(language) {
  return !language || language === 'auto' ? 'multi' : language;
}

async function transcribeDeepgram(apiKey, audioPath, language) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Deepgram API key not set. Please enter your API key in settings.');

  const audioBuffer = fs.readFileSync(audioPath);
  const { createClient } = require('@deepgram/sdk');
  const deepgram = createClient(key);
  const options = {
    model: 'nova-3',
    language: deepgramLanguage(language),
    smart_format: true,
  };

  // The SDK appends every non-empty option as a query parameter. Log the exact
  // query string so request/parameter mismatches are visible before the call.
  if (process.env.KIMFLOW_DEBUG === '1') {
    const query = new URL('https://api.deepgram.com/v1/listen');
    Object.keys(options).forEach((keyName) => query.searchParams.append(keyName, String(options[keyName])));
    console.log(`[KimFlow] Deepgram request URL: ${query.toString()}`);
  }

  const response = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, options);

  if (response?.error) {
    throw new Error(`Deepgram error: ${response.error.message || response.error}`);
  }
  const channel = response?.result?.results?.channels?.[0];
  const transcript = channel?.alternatives?.[0]?.transcript;
  if (!transcript) throw new Error('No transcription result from Deepgram');
  const detectedLanguage = channel?.detected_language || channel?.detectedLanguage || null;
  return { text: cleanupText(transcript), detectedLanguage };
}

async function transcribeGroq(apiKey, audioPath, language) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Groq API key not set. Please enter your API key in settings.');

  const FormData = require('form-data');
  const form = new FormData();
  form.append('model', 'whisper-large-v3-turbo');
  const languageOptionsFields = languageOptions(language);
  if (languageOptionsFields.language) form.append('language', languageOptionsFields.language);
  form.append('response_format', 'verbose_json');
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
    const detectedLanguage = typeof response.data?.language === 'string' ? response.data.language : null;
    return { text: cleanupText(text), detectedLanguage };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Groq API error') || message.startsWith('No transcription')) throw error;
    throw new Error(`Groq API request failed: ${message}`);
  }
}

async function transcribeLocal(modelSize, audioPath, language) {
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

function detectedLanguageFromOutput(output) {
  const text = String(output || '');
  const match = text.match(/detected language[:\s]+([a-z]{2,3})/i) || text.match(/\blanguage[:\s]+([a-z]{2,3})\b/i);
  return match ? match[1].toLowerCase() : null;
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
