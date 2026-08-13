import { recordBtn, micBtn, pauseBtn, stopBtn, endBtn } from './dom';
import { getSettings } from './store';
import { errorMessage } from './utils';
import { STATES, getCurrentState, setState, showError, showTranscript } from './status';
import { clearTranslation, showTranslation } from './translation';
import {
  abortCapture,
  captureState,
  pauseCapture,
  resumeCapture,
  startCapture,
  stopCapture,
} from './audio/recorder';

let isToggling = false;

export async function beginRecording() {
  const settings = getSettings();
  if (!settings || getCurrentState() !== STATES.READY || isToggling) return;
  isToggling = true;
  try {
    await startCapture(settings.microphone);
    await window.api.startRecording();
    setState(STATES.RECORDING);
  } catch (error) {
    abortCapture();
    await window.api.cancelRecording().catch(() => undefined);
    setState(STATES.READY);
    showError(errorMessage(error, 'Unable to start recording'));
  } finally {
    isToggling = false;
  }
}

export async function finishRecording() {
  if ((getCurrentState() !== STATES.RECORDING && getCurrentState() !== STATES.PAUSED) || isToggling) return;
  isToggling = true;
  setState(STATES.TRANSCRIBING);
  try {
    const wav = await stopCapture();
    const result = await window.api.stopRecording(wav);
    if (result) {
      showTranscript(result.text);
      showTranslation(result.translation, result.translationError);
    }
  } catch (error) {
    abortCapture();
    await window.api.cancelRecording().catch(() => undefined);
    setState(STATES.READY);
    showError(errorMessage(error, 'Transcription failed'));
  } finally {
    isToggling = false;
  }
}

async function pauseFromOverlay() {
  try {
    pauseCapture();
    await window.api.pauseRecording();
  } catch (error) {
    if (captureState() === 'paused') resumeCapture();
    showError(errorMessage(error, 'Unable to pause recording'));
  }
}

async function resumeFromOverlay() {
  try {
    resumeCapture();
    await window.api.resumeRecording();
  } catch (error) {
    if (captureState() === 'recording') pauseCapture();
    showError(errorMessage(error, 'Unable to resume recording'));
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
  if (result) {
    showTranscript(result.text);
    showTranslation(result.translation, result.translationError);
  }
}

export function wireRecordingControls() {
  wireToggle(recordBtn);
  wireToggle(micBtn);

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
