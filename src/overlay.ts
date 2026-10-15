/**
 * Floating overlay renderer.
 *
 * `src/overlay.html` is a Vite build input, so this module can import the
 * shared `src/i18n/` bundle directly — no IPC, no duplicated locale data.
 * Language and accent colour ride the existing `settings-updated` channel.
 */
import { applyLanguage, renderStatic, t } from './i18n';

const mic = document.getElementById('mic')!;
const stateText = document.getElementById('state-text')!;
const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
const resumeBtn = document.getElementById('resume-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel-btn') as HTMLButtonElement;
const buttons = [startBtn, pauseBtn, resumeBtn, stopBtn, cancelBtn];

let currentState = 'ready';

/** Localised label for a recording state. */
function stateLabel(state: string): string {
  if (state === 'recording') return t('overlay.listening');
  if (state === 'paused') return t('status.paused');
  if (state === 'transcribing') return t('status.transcribing');
  return t('status.ready');
}

function update(state: string): void {
  currentState = state;
  mic.className = 'mic';
  if (state === 'recording') mic.classList.add('recording');
  if (state === 'paused') mic.classList.add('paused');
  if (state === 'transcribing') mic.classList.add('transcribing');
  stateText.textContent = stateLabel(state);
  buttons.forEach((button) => { button.disabled = state === 'transcribing'; });
  startBtn.classList.toggle('hidden', state !== 'ready');
  pauseBtn.classList.toggle('hidden', state !== 'recording');
  resumeBtn.classList.toggle('hidden', state !== 'paused');
  stopBtn.classList.toggle('hidden', state !== 'recording' && state !== 'paused');
  cancelBtn.classList.toggle('hidden', state === 'ready');
}

function applyAccent(color: string): void {
  document.documentElement.style.setProperty('--accent', color);
  document.documentElement.style.setProperty('--accent-glow', `${color}66`);
}

/** Apply the UI language to the overlay and re-render its text. */
function applyOverlayLanguage(language: string): void {
  applyLanguage(language);
  renderStatic();
  stateText.textContent = stateLabel(currentState);
}

const actionButtons: Array<[HTMLButtonElement, string]> = [
  [startBtn, 'start'],
  [pauseBtn, 'pause'],
  [resumeBtn, 'resume'],
  [stopBtn, 'stop'],
  [cancelBtn, 'cancel'],
];

for (const [button, action] of actionButtons) {
  button.addEventListener('click', () => {
    void window.api.overlayAction(action).catch(() => {
      stateText.textContent = t('overlay.actionUnavailable');
    });
  });
}

window.api.onRecordingState(update);
window.api.onSettingsUpdated((settings) => {
  applyAccent(settings.accentColor);
  applyOverlayLanguage(settings.uiLanguage);
});

window.api.getSettings().then((settings) => {
  applyAccent(settings.accentColor);
  applyOverlayLanguage(settings.uiLanguage);
}).catch(() => { /* keep the English default until settings arrive */ });

window.api.getRecordingState().then(update).catch(() => update('ready'));

// Render the default language immediately so nothing shows a raw key before
// the first settings payload arrives.
applyOverlayLanguage('en');
