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
    statusText.textContent = 'Recording';
    pauseBtn.textContent = 'Pause';
  } else if (state === STATES.PAUSED) {
    recordBtn.classList.add('recording');
    recordIconMic.style.display = 'none';
    recordIconStop.style.display = 'block';
    statusDot.classList.add('recording');
    statusText.textContent = 'Paused';
    pauseBtn.textContent = 'Resume';
  } else if (state === STATES.TRANSCRIBING) {
    recordBtn.classList.add('transcribing');
    statusDot.classList.add('transcribing');
    statusText.textContent = 'Transcribing…';
  } else {
    statusDot.classList.add('ready');
    statusText.textContent = 'Ready';
  }

  recordBtn.disabled = !interactive;
  recordBtn.setAttribute('aria-label', state === STATES.RECORDING ? 'Stop Recording' : 'Start Recording');
  micBtn.disabled = !interactive;
  pauseBtn.disabled = !active;
  stopBtn.disabled = !active;
  endBtn.disabled = !interactive;
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
  showToast('Paste failed — text copied to clipboard, press Ctrl+V');
}
