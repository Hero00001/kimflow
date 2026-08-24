const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./settings.cjs');

const ALLOWED_MODELS = new Set(['tiny', 'base', 'small', 'medium']);

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
  validateModelSize,
  modelFilename,
  modelDownloadUrl,
  modelDownloaded,
  downloadModel,
};
