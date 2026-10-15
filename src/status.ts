import {
  statusDot,
  statusText,
  statusError,
  recordBtn,
  recordIconMic,
  recordIconStop,
  pauseBtn,
  stopBtn,
  endBtn,
  micBtn,
  transcriptText,
} from './dom';
import { t } from './i18n';

let currentState = 'ready';

export const STATES = {
  READY: 'ready',
  RECORDING: 'recording',
  PAUSED: 'paused',
  TRANSCRIBING: 'transcribing',
} as const;

export function getCurrentState(): string {
  return currentState;
}

type StateListener = (state: string) => void;
const stateListeners = new Set<StateListener>();

export function onStateChange(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

/** Set the status text and pause/resume label for the current state. */
function applyStateText(state: string): void {
  if (state === STATES.RECORDING) {
    statusText.textContent = t('status.recording');
    pauseBtn.textContent = t('status.pause');
  } else if (state === STATES.PAUSED) {
    statusText.textContent = t('status.paused');
    pauseBtn.textContent = t('status.resume');
  } else if (state === STATES.TRANSCRIBING) {
    statusText.textContent = t('status.transcribing');
  } else {
    statusText.textContent = t('status.ready');
  }
  recordBtn.setAttribute('aria-label', state === STATES.RECORDING ? t('status.stopRecording') : t('status.startRecording'));
}

/**
 * Re-apply the current state's text after a UI-language change. Does not touch
 * classes or disabled state, so it is safe to call at any time.
 */
export function refreshStatusText(): void {
  applyStateText(currentState);
}

export function setState(state: string) {
  currentState = state;
  recordBtn.classList.remove('recording', 'transcribing');
  recordIconMic.style.display = 'flex';
  recordIconStop.style.display = 'none';
  statusDot.className = '';
  statusError.classList.add('hidden');

  const interactive = state !== STATES.TRANSCRIBING;
  const active = state === STATES.RECORDING || state === STATES.PAUSED;

  if (state === STATES.RECORDING) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('recording');
  } else if (state === STATES.PAUSED) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('recording');
  } else if (state === STATES.TRANSCRIBING) {
    recordBtn.classList.add('transcribing');
    statusDot.classList.add('transcribing');
  } else {
    statusDot.classList.add('ready');
  }

  applyStateText(state);

  recordBtn.disabled = !interactive;
  micBtn.disabled = !interactive;
  pauseBtn.disabled = !active;
  stopBtn.disabled = !active;
  endBtn.disabled = !interactive;
  stateListeners.forEach((listener) => {
    try {
      listener(state);
    } catch {
      // Listener errors must never break state transitions.
    }
  });
}

export function showError(message: string) {
  statusError.textContent = message;
  statusError.classList.remove('hidden');
}

export function showTranscript(text: string) {
  transcriptText.textContent = text || '';
}

export function showToast(message: string) {
  document.getElementById('copy-toast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.remove(), 1500);
}

export function showPasteFallback() {
  showToast(t('toast.pasteFallback'));
}
