const fs = require('fs');
const path = require('path');

/**
 * Device enumeration is intentionally handled by the renderer's mediaDevices
 * API. Keeping this endpoint preserves the IPC contract for older clients.
 */
function listMicrophones() {
  return [];
}

function isWavBuffer(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WAVE';
}

class AudioRecorder {
  constructor() {
    this.chunks = [];
    this.audioBuffer = null;
    this.isRecording = false;
  }

  start() {
    this.chunks = [];
    this.audioBuffer = null;
    this.isRecording = true;
    return Promise.resolve();
  }

  onChunk(chunk) {
    if (!this.isRecording || chunk == null) return;
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  stop(audioBuffer) {
    this.isRecording = false;
    if (audioBuffer != null) {
      const buffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
      if (!isWavBuffer(buffer)) {
        throw new Error('Captured audio is not a valid WAV file');
      }
      this.audioBuffer = buffer;
    }
    return Promise.resolve();
  }

  saveWav(filePath) {
    return new Promise((resolve, reject) => {
      const raw = this.audioBuffer || (this.chunks.length > 0 ? Buffer.concat(this.chunks) : null);
      if (!raw || raw.length === 0) {
        return reject(new Error('No audio captured'));
      }
      if (!isWavBuffer(raw)) {
        return reject(new Error('Audio must be a valid WAV file'));
      }

      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, raw);
        resolve(filePath);
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = { listMicrophones, AudioRecorder, isWavBuffer };
