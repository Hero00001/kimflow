import {
  copyBtn,
  transcriptText,
  navButtons,
  pages,
  winMin,
  winMax,
  winClose,
} from './dom';
import { setSettings } from './store';
import { errorMessage } from './utils';
import { STATES, setState, showError, showToast, showTranscript } from './status';
import { populateMics, requestMicPermission } from './audio/recorder';
import {
  applySettingsToUi,
  checkModelStatus,
  handleDownloadProgress,
  loadSettingsIntoUi,
  wireSettingsControls,
} from './settings-form';
import { wireTranslationControls } from './translation';
import { refreshHistory, setHistoryData, wireHistory } from './history';
import {
  handleHotkeyPressed,
  handleOverlayAction,
  handleTranscriptionResult,
  wireRecordingControls,
} from './recording';

function goToPage(page: string) {
  (Object.keys(pages) as Array<keyof typeof pages>).forEach((name) => {
    pages[name].classList.toggle('hidden', name !== page);
  });
  navButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.page === page);
  });
  if (page === 'history') refreshHistory();
}

function wireNavigation() {
  navButtons.forEach((button) => {
    button.addEventListener('click', () => goToPage(button.dataset.page || 'transcribe'));
  });
}

if (/mac/i.test(navigator.platform || navigator.userAgent)) {
  document.body.classList.add('platform-mac');
}

function wireWindowControls() {
  winMin.addEventListener('click', () => void window.api.windowControl('minimize'));
  winMax.addEventListener('click', () => void window.api.windowControl('toggle-maximize'));
  winClose.addEventListener('click', () => void window.api.windowControl('close'));
}

function wireCopy() {
  copyBtn.addEventListener('click', async () => {
    const text = transcriptText.textContent || '';
    if (!text) return;
    try {
      await window.api.copyText(text);
      showToast('Copied!');
    } catch {
      showError('Unable to copy transcript');
    }
  });
}

async function init() {
  const unsubscribers = [
    window.api.onOverlayAction((action) => handleOverlayAction(action)),
    window.api.onSettingsUpdated((settings) => applySettingsToUi(settings)),
    // Electron globalShortcut reports key-down, not key-up. Treat the global
    // shortcut as a safe toggle even when the UI is configured for push-to-talk;
    // the on-screen button still provides true press/release behavior.
    window.api.onHotkeyPressed((event) => handleHotkeyPressed(event)),
    window.api.onRecordingState((state) => setState(state)),
    window.api.onTranscriptionResult((result) => handleTranscriptionResult(result)),
    window.api.onDownloadProgress((progress) => handleDownloadProgress(progress)),
    window.api.onHistoryUpdated((data) => setHistoryData(data)),
  ];
  window.addEventListener('beforeunload', () => unsubscribers.forEach((unsubscribe) => unsubscribe()), { once: true });

  try {
    await loadSettingsIntoUi(await window.api.getSettings());
    await requestMicPermission();
    await Promise.all([populateMics(), checkModelStatus()]);
    setState(await window.api.getRecordingState());
    refreshHistory();
  } catch (error) {
    setSettings({
      microphone: 'default', engine: 'local', whisperModel: 'small',
      deepgramApiKey: '', groqApiKey: '', recordingMode: 'toggle',
      hotkey: 'CmdOrCtrl+Shift+Space', accentColor: '#8b5cf6',
      translationEnabled: false, translationProvider: 'gemini',
      geminiApiKey: '', geminiModel: '', inputLanguage: 'auto', translationTarget: 'en',
    });
    setState(STATES.READY);
    showError(errorMessage(error, 'Unable to load settings'));
  }
}

wireNavigation();
wireWindowControls();
wireCopy();
wireSettingsControls();
wireTranslationControls();
wireHistory((entry) => {
  showTranscript(entry.text);
  goToPage('transcribe');
});
wireRecordingControls();

void init();
