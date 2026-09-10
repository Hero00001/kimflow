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

// Best-effort free-space guard run before writing the WAV file. It must never
// throw: platforms without fs.statfsSync (or any stat failure) skip silently
// so recording can never crash on an unsupported platform.
const MIN_FREE_DISK_BYTES = 32 * 1024 * 1024;

function ensureDiskSpace(dir, requiredBytes = MIN_FREE_DISK_BYTES) {
  try {
    if (typeof fs.statfsSync !== 'function') return { ok: true, skipped: true };
    const stats = fs.statfsSync(dir || path.dirname(osTmpFallback()));
    const free = Number(stats.bfree) * Number(stats.bsize);
    if (!Number.isFinite(free)) return { ok: true, skipped: true };
    if (free < Number(requiredBytes)) {
      return { ok: false, skipped: false, freeBytes: free, error: `Insufficient disk space (${free} bytes free)` };
    }
    return { ok: true, skipped: false, freeBytes: free };
  } catch {
    return { ok: true, skipped: true };
  }
}

function osTmpFallback() {
  try {
    return require('os').tmpdir();
  } catch {
    return '.';
  }
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
        const space = ensureDiskSpace(path.dirname(filePath), Math.max(raw.length, MIN_FREE_DISK_BYTES));
        if (!space.ok) {
          return reject(new Error(space.error || 'Insufficient disk space'));
        }
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, raw);
        resolve(filePath);
      } catch (error) {
        reject(error);
      }
    });
  }
}

module.exports = { listMicrophones, AudioRecorder, isWavBuffer, ensureDiskSpace, MIN_FREE_DISK_BYTES };
