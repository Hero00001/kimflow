const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { AudioRecorder } = require('./audio.cjs');
const { cleanupText } = require('./cleanup.cjs');
const { pasteText } = require('./paste.cjs');
const { transcribeDeepgram, transcribeSpeechmatics, transcribeLocal } = require('./transcribe.cjs');
const translationService = require('./translation.service.cjs');
const { CONFIG_DIR } = require('./settings.cjs');
const { getSecret } = require('./secrets.cjs');
const history = require('./history.cjs');
const { selectPasteText, isAbortError } = require('./recorder-decisions.cjs');

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
let activeAbortController = null;

const MAX_RECORDING_MS = 10*60*1000;
let autoStopTimer = null;

function clearAutoStopTimer() {
  if (autoStopTimer) {
    clearTimeout(autoStopTimer);
    autoStopTimer = null;
  }
}

function emitTimeLimit(target) {
  for (const window of windowsFrom(target)) {
    sendToWindow(window, 'recording-time-limit', { maxRecordingMs: MAX_RECORDING_MS });
  }
}

// On expiry the renderer runs its normal finishRecording() path (stopCapture
// + stopRecording IPC), so a 10-minute dictation is transcribed, pasted, and
// saved to history — never silently discarded.
function scheduleAutoStopTimer(windows, delayMs = MAX_RECORDING_MS) {
  clearAutoStopTimer();
  const targets = windowsFrom(windows);
  autoStopTimer = setTimeout(() => {
    autoStopTimer = null;
    emitTimeLimit(targets);
  }, delayMs);
  if (autoStopTimer && typeof autoStopTimer.unref === 'function') autoStopTimer.unref();
}

function shouldDropResult(opAtStop, opNow) {
  return opAtStop !== opNow;
}

function windowsFrom(target) {
  if (!target) return [];
  return Array.isArray(target) ? target.filter(Boolean) : [target];
}

function sendToWindow(window, channel, payload) {
  if (!window || window.isDestroyed()) return;
  if (window.webContents?.isDestroyed?.() === true) return;
  try {
    window.webContents.send(channel, payload);
  } catch { /* window died mid-send */ }
}

function notify(target, state) {
  for (const window of windowsFrom(target)) sendToWindow(window, 'recording-state', state);
}

function notifyHistory(target) {
  for (const window of windowsFrom(target)) sendToWindow(window, 'history-updated', history.load());
}

function emitTranscription(target, payload) {
  for (const window of windowsFrom(target)) sendToWindow(window, 'transcription-result', payload);
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
    scheduleAutoStopTimer(windows);
    notify(windows, STATE.RECORDING);
  } catch (error) {
    clearAutoStopTimer();
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
  clearAutoStopTimer();
  if (activeAbortController) {
    try { activeAbortController.abort(); } catch { /* already aborted */ }
    activeAbortController = null;
  }
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

  const abortController = new AbortController();
  activeAbortController = abortController;
  const signal = abortController.signal;

  const tempPath = path.join(CONFIG_DIR, `temp_recording_${crypto.randomUUID()}.wav`);
  const recorder = audioRecorder;
  audioRecorder = null;

  try {
    if (!recorder) throw new Error('Recording session is unavailable');
    await recorder.stop(audioBuffer);
    await recorder.saveWav(tempPath);

    const language = settings.inputLanguage || 'auto';
    // Warm the Gemini model lookup in parallel with transcription so the
    // first stop after (re)start does not pay an extra round-trip.
    if (settings.translationEnabled) {
      void translationService.warmup({
        apiKey: settings.geminiApiKey || getSecret('geminiApiKey'),
        model: settings.geminiModel || undefined,
        provider: settings.translationProvider,
      });
    }
    let transcription;
    try {
      switch (settings.engine) {
        case 'local':
          transcription = await transcribeLocal(settings.whisperModel, tempPath, language, settings.whisperBinaryPath || '', signal, settings.polishMode, settings.customVocabulary);
          break;
        case 'deepgram':
          transcription = await transcribeDeepgram(settings.deepgramApiKey || getSecret('deepgramApiKey'), tempPath, language, settings.deepgramModel, signal, settings.polishMode, settings.customVocabulary);
          break;
        case 'speechmatics':
          transcription = await transcribeSpeechmatics(settings.speechmaticsApiKey || getSecret('speechmaticsApiKey'), tempPath, language, signal, settings.polishMode, settings.customVocabulary);
          break;
        default:
          throw new Error(`Unknown engine: ${settings.engine}`);
      }
    } catch (error) {
      // Cancel aborts the in-flight request; a late abort must look like a
      // dropped result, not a transcription failure.
      if (isAbortError(error, signal)) return { text: '', aborted: true };
      throw error;
    }

    // Cancellation cannot always abort a provider's in-flight HTTP request,
    // but it must prevent a late result from being pasted or shown.
    if (shouldDropResult(currentOperation, operationId)) return { text: '', aborted: true };
    const cleaned = cleanupText(transcription?.text || '', settings.polishMode);
    if (!cleaned) { const e = new Error('No speech detected — check mic level and try again.'); e.details = `empty transcript (engine=${settings.engine})`; throw e; }
    // AI polish is a best-effort refinement of the rule-polished text. Any
    // failure (no key, quota, network) falls back to `cleaned` silently —
    // the transcription result must never break on an optional pass.
    let finalText = cleaned;
    let polished = false;
    if (settings.aiPolish) {
      try {
        const polishedText = await translationService.polish({
          text: cleaned,
          language: transcription?.detectedLanguage || language,
          provider: settings.translationProvider,
          apiKey: settings.geminiApiKey || getSecret('geminiApiKey'),
          model: settings.geminiModel || undefined,
        });
        if (polishedText) {
          finalText = polishedText;
          polished = true;
        }
      } catch {
        // Fall back to the rule-polished text.
      }
    }
    let pasteOk = true;
    let pasteFallback = null;
    const doPaste = (text) => {
      try {
        const pasteResult = pasteText(text);
        pasteOk = !pasteResult || pasteResult.ok !== false;
      } catch {
        pasteOk = false;
      }
      if (!pasteOk) pasteFallback = text;
    };
    // Without translation the transcript pastes immediately. With
    // translation enabled the paste waits below for the translated text —
    // pasting the original first would defeat the feature.
    if (!settings.translationEnabled) doPaste(selectPasteText({ translationEnabled: false, translation: null, finalText }));
    let historyId = null;
    try {
      const entry = history.addSession({
        text: finalText,
        durationMs: startedAt ? Date.now() - startedAt : 0,
      });
      historyId = entry ? entry.id : null;
      notifyHistory(windows);
    } catch (error) {
      console.error('[KimFlow] Failed to save history:', error.message);
    }

    // Emit the transcript immediately so translation latency never blocks
    // display/paste. The translation result follows on the same channel.
    if (settings.translationEnabled) {
      emitTranscription(windows, { text: finalText, translation: null, translationError: null, translating: true, pasteFallback, pasteOk, polished });
    }

    // Translation is a best-effort add-on. A provider failure must never
    // break the transcription result, so it is isolated and reported softly.
    // A successful translation is what gets pasted; anything else falls
    // back to the transcribed text.
    let translation = null;
    let translationError = null;
    if (settings.translationEnabled) {
      try {
        translation = await translationService.translate({
          text: finalText,
          sourceLanguage: transcription?.detectedLanguage || language,
          targetLanguage: settings.translationTarget,
          provider: settings.translationProvider,
          apiKey: settings.geminiApiKey || getSecret('geminiApiKey'),
          model: settings.geminiModel || undefined,
        });
      } catch (error) {
        translationError = error instanceof Error && error.message ? error.message : String(error);
      }
      doPaste(selectPasteText({ translationEnabled: true, translation, finalText }));
      if (historyId) {
        try {
          history.updateSession(historyId, {
            translation,
            translationTarget: settings.translationTarget,
            translationError,
          });
          notifyHistory(windows);
        } catch (error) {
          console.error('[KimFlow] Failed to update history translation:', error.message);
        }
      }
      // The IPC layer broadcasts the returned result exactly once;
      // emitting it here too would deliver the final transcript
      // twice on the same channel.
      const final = { text: finalText, translation, translationError, translating: false, pasteFallback, pasteOk, polished };
      return final;
    }
    return { text: finalText, translation, translationError, translating: false, pasteFallback, pasteOk, polished };
  } finally {
    if (activeAbortController === abortController) activeAbortController = null;
    try { fs.unlinkSync(tempPath); } catch { /* no temp file to remove */ }
    // A stale stop (cancelled and restarted while transcribing) must not
    // reset the live session or kill its auto-stop timer.
    if (!shouldDropResult(currentOperation, operationId)) {
      clearAutoStopTimer();
      currentState = STATE.READY;
      notify(windows, STATE.READY);
    }
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
  shouldDropResult,
  scheduleAutoStopTimer,
  clearAutoStopTimer,
  MAX_RECORDING_MS,
  STATE,
};
