const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AudioRecorder } = require('./audio.cjs');
const { cleanupText } = require('./cleanup.cjs');
const { pasteText } = require('./paste.cjs');
const { transcribeDeepgram, transcribeGroq, transcribeLocal } = require('./transcribe.cjs');
const { CONFIG_DIR } = require('./settings.cjs');
const history = require('./history.cjs');

const STATE = {
  READY: 'ready',
  RECORDING: 'recording',
  PAUSED: 'paused',
  TRANSCRIBING: 'transcribing',
};

let currentState = STATE.READY;
let audioRecorder = null;
let operationId = 0;
let recordingStartedAt = null;

function windowsFrom(target) {
  if (!target) return [];
  return Array.isArray(target) ? target.filter(Boolean) : [target];
}

function notify(target, state) {
  for (const window of windowsFrom(target)) {
    if (!window.isDestroyed?.()) {
      window.webContents.send('recording-state', state);
    }
  }
}

function notifyHistory(target) {
  for (const window of windowsFrom(target)) {
    if (!window.isDestroyed?.()) {
      window.webContents.send('history-updated', history.load());
    }
  }
}

function getState() {
  return currentState;
}

async function startRecording(settings, windows) {
  if (currentState !== STATE.READY) {
    throw new Error('Already recording or transcribing');
  }

  const recorder = new AudioRecorder();
  try {
    await recorder.start();
    audioRecorder = recorder;
    operationId += 1;
    recordingStartedAt = Date.now();
    currentState = STATE.RECORDING;
    notify(windows, STATE.RECORDING);
  } catch (error) {
    audioRecorder = null;
    currentState = STATE.READY;
    throw error;
  }
}

function onAudioChunk(chunk) {
  if (audioRecorder && currentState === STATE.RECORDING) {
    audioRecorder.onChunk(chunk);
  }
}

async function pauseRecording(windows) {
  if (currentState !== STATE.RECORDING) throw new Error('Recording is not active');
  currentState = STATE.PAUSED;
  notify(windows, STATE.PAUSED);
}

async function resumeRecording(windows) {
  if (currentState !== STATE.PAUSED) throw new Error('Recording is not paused');
  currentState = STATE.RECORDING;
  notify(windows, STATE.RECORDING);
}

async function cancelRecording(windows) {
  operationId += 1;
  recordingStartedAt = null;
  if (audioRecorder) {
    try { await audioRecorder.stop(); } catch { /* already stopped */ }
  }
  audioRecorder = null;
  if (currentState !== STATE.READY) {
    currentState = STATE.READY;
    notify(windows, STATE.READY);
  }
}

async function stopRecording(settings, windows, audioBuffer) {
  if (currentState !== STATE.RECORDING && currentState !== STATE.PAUSED) {
    throw new Error('Not currently recording');
  }

  const currentOperation = operationId;
  const startedAt = recordingStartedAt;
  recordingStartedAt = null;
  currentState = STATE.TRANSCRIBING;
  notify(windows, STATE.TRANSCRIBING);

  const tempPath = path.join(CONFIG_DIR, `temp_recording_${crypto.randomUUID()}.wav`);
  const recorder = audioRecorder;
  audioRecorder = null;

  try {
    if (!recorder) throw new Error('Recording session is unavailable');
    await recorder.stop(audioBuffer);
    await recorder.saveWav(tempPath);

    let rawText;
    switch (settings.engine) {
      case 'local':
        rawText = await transcribeLocal(settings.whisperModel, tempPath);
        break;
      case 'deepgram':
        rawText = await transcribeDeepgram(settings.deepgramApiKey, tempPath);
        break;
      case 'groq':
        rawText = await transcribeGroq(settings.groqApiKey, tempPath);
        break;
      default:
        throw new Error(`Unknown engine: ${settings.engine}`);
    }

    // Cancellation cannot always abort a provider's in-flight HTTP request,
    // but it must prevent a late result from being pasted or shown.
    if (currentOperation !== operationId) return '';
    const cleaned = cleanupText(rawText || '');
    if (cleaned) {
      pasteText(cleaned);
      try {
        history.addSession({
          text: cleaned,
          durationMs: startedAt ? Date.now() - startedAt : 0,
        });
        notifyHistory(windows);
      } catch (error) {
        console.error('[KimFlow] Failed to save history:', error.message);
      }
    }
    return cleaned;
  } finally {
    try { fs.unlinkSync(tempPath); } catch { /* no temp file to remove */ }
    currentState = STATE.READY;
    notify(windows, STATE.READY);
  }
}

module.exports = {
  getState,
  startRecording,
  stopRecording,
  pauseRecording,
  resumeRecording,
  cancelRecording,
  onAudioChunk,
  STATE,
};
