import { recordBtn, micBtn, pauseBtn, stopBtn, endBtn, statusError } from './dom';
import { getSettings } from './store';
import { errorDetails, friendlyError } from './utils';
import { STATES, getCurrentState, setState, showError, showPasteFallback, showTranscript } from './status';
import { clearTranslation, showTranslating, showTranslation } from './translation';
import {
  abortCapture,
  captureState,
  pauseCapture,
  resumeCapture,
  startCapture,
  stopCapture,
  watchMicDeviceChanges,
} from './audio/recorder';

export async function beginRecording() {
  const settings = getSettings();
  if (!settings || getCurrentState() !== STATES.READY) return;
  try {
    await startCapture(settings.microphone);
    await window.api.startRecording();
    setState(STATES.RECORDING);
  } catch (error) {
    abortCapture();
    await window.api.cancelRecording().catch(() => undefined);
    setState(STATES.READY);
    const friendly = friendlyError(error, 'Unable to start recording');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

export async function finishRecording() {
  if (getCurrentState() !== STATES.RECORDING && getCurrentState() !== STATES.PAUSED) return;
  setState(STATES.TRANSCRIBING);
  try {
    const wav = await stopCapture();
    const result = await window.api.stopRecording(wav);
    if (result && result.aborted) {
      setState(STATES.READY);
      return;
    }
    if (result) {
      showTranscript(result.text);
      if (result.translating) showTranslating();
      else showTranslation(result.translation, result.translationError);
      if (result.pasteOk === false) showPasteFallback();
    }
  } catch (error) {
    abortCapture();
    await window.api.cancelRecording().catch(() => undefined);
    setState(STATES.READY);
    const friendly = friendlyError(error, 'Transcription failed');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

async function pauseFromOverlay() {
  try {
    pauseCapture();
    await window.api.pauseRecording();
  } catch (error) {
    if (captureState() === 'paused') resumeCapture();
    const friendly = friendlyError(error, 'Unable to pause recording');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

async function resumeFromOverlay() {
  try {
    resumeCapture();
    await window.api.resumeRecording();
  } catch (error) {
    if (captureState() === 'recording') pauseCapture();
    const friendly = friendlyError(error, 'Unable to resume recording');
    if (friendly) showError(friendly);
    statusError.title = errorDetails(error) ?? '';
  }
}

async function cancelFromOverlay() {
  abortCapture();
  try {
    await window.api.cancelRecording();
  } finally {
    setState(STATES.READY);
  }
}

async function handleTrigger(pressed: boolean) {
  const mode = getSettings()?.recordingMode || 'toggle';
  if (mode === 'push-to-talk') {
    // Electron globalShortcut exposes key presses but not releases. The on-screen
    // button remains true push-to-talk; the global shortcut safely toggles instead
    // of leaving a recording stuck forever.
    if (pressed) {
      if (getCurrentState() === STATES.READY) await beginRecording();
      else if (getCurrentState() === STATES.RECORDING) await finishRecording();
    } else {
      await finishRecording();
    }
  } else if (pressed) {
    if (getCurrentState() === STATES.READY) await beginRecording();
    else if (getCurrentState() === STATES.RECORDING) await finishRecording();
    else if (getCurrentState() === STATES.PAUSED) await resumeFromOverlay();
  }
}

function wireToggle(button: HTMLButtonElement) {
  button.addEventListener('click', () => {
    if (getSettings()?.recordingMode === 'toggle') void handleTrigger(true);
  });
  button.addEventListener('pointerdown', (event) => {
    if (getSettings()?.recordingMode === 'push-to-talk') {
      event.preventDefault();
      void handleTrigger(true);
    }
  });
  button.addEventListener('pointerup', (event) => {
    if (getSettings()?.recordingMode === 'push-to-talk') {
      event.preventDefault();
      void handleTrigger(false);
    }
  });
  button.addEventListener('pointerleave', () => {
    if (getSettings()?.recordingMode === 'push-to-talk') void handleTrigger(false);
  });
}

export function handleOverlayAction(action: string) {
  if (action === 'start') void beginRecording();
  else if (action === 'pause') void pauseFromOverlay();
  else if (action === 'resume') void resumeFromOverlay();
  else if (action === 'stop') void finishRecording();
  else if (action === 'cancel') void cancelFromOverlay();
}

export function handleHotkeyPressed(event: HotkeyEvent) {
  if (event.pressed) {
    void (getCurrentState() === STATES.READY ? beginRecording() : finishRecording());
  }
}

export function handleTranscriptionResult(result: TranscriptionResult) {
  if (result && result.aborted) return;
  if (result) {
    showTranscript(result.text);
    if (result.translating) showTranslating();
    else showTranslation(result.translation, result.translationError);
    if (result.pasteOk === false) showPasteFallback();
  }
}

export function wireRecordingControls() {
  wireToggle(recordBtn);
  wireToggle(micBtn);

  // A removed microphone pauses instead of cancelling: audio captured so far
  // is kept and the user can resume on another device.
  watchMicDeviceChanges(() => {
    void window.api.pauseRecording().catch((error) => {
      const friendly = friendlyError(error, 'Unable to pause recording');
      if (friendly) showError(friendly);
      statusError.title = errorDetails(error) ?? '';
    });
    if (getCurrentState() === STATES.RECORDING) setState(STATES.PAUSED);
  });

  // The 10-minute backend guard reuses the normal finish path, so the
  // dictation is transcribed, pasted, and saved — never discarded.
  window.api.onRecordingTimeLimit(() => {
    void finishRecording();
  });

  pauseBtn.addEventListener('click', () => {
    if (getCurrentState() === STATES.RECORDING) void pauseFromOverlay();
    else if (getCurrentState() === STATES.PAUSED) void resumeFromOverlay();
  });

  stopBtn.addEventListener('click', () => void finishRecording());

  endBtn.addEventListener('click', () => {
    if (getCurrentState() !== STATES.READY) {
      void cancelFromOverlay();
    }
    showTranscript('');
    clearTranslation();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
    if (getCurrentState() === STATES.RECORDING || getCurrentState() === STATES.PAUSED) {
      void finishRecording();
    }
  });
}
