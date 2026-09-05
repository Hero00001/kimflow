import {
  translationArea,
  translationError,
  translationText,
  providerRow,
  translateToRow,
  providerSelect,
  inputLanguageSelect,
  translateToSelect,
  geminiKey,
  geminiModel,
  geminiModelStatus,
  translationGroup,
  copyTranslationBtn,
} from './dom';
import { getSettings } from './store';
import { showError, showToast } from './status';

export function showTranslation(translation: string | null, error: string | null = null) {
  translationText.textContent = translation || '';
  if (error) {
    translationError.textContent = `Translation failed: ${error}`;
    translationError.classList.remove('hidden');
  } else {
    translationError.classList.add('hidden');
  }
  translationArea.classList.toggle('hidden', !(getSettings()?.translationEnabled && (translation || error)));
}

export function showTranslating() {
  if (!getSettings()?.translationEnabled) return;
  translationText.textContent = 'Translating…';
  translationError.classList.add('hidden');
  translationArea.classList.remove('hidden');
}

export function clearTranslation() {
  translationText.textContent = '';
  translationError.textContent = '';
  translationError.classList.add('hidden');
  translationArea.classList.add('hidden');
}

export function setTranslationUi(enabled: boolean) {
  providerRow.classList.toggle('hidden', !enabled);
  translateToRow.classList.toggle('hidden', !enabled);
}

export function syncTranslationControls() {
  const settings = getSettings();
  if (!settings) return;
  providerSelect.value = settings.translationProvider || 'gemini';
  inputLanguageSelect.value = settings.inputLanguage || 'auto';
  translateToSelect.value = settings.translationTarget || 'en';
  geminiKey.value = settings.geminiApiKey || '';
  geminiModel.value = settings.geminiModel || '';
  translationGroup.querySelectorAll('.toggle-btn').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.value === (settings.translationEnabled ? 'on' : 'off'));
  });
  setTranslationUi(settings.translationEnabled);
  if (!settings.geminiModel) {
    setModelStatus('neutral', 'Leave empty for automatic model selection.');
  } else {
    void validateModelField();
  }
}

function setModelStatus(status: 'neutral' | 'ok' | 'err', text: string) {
  geminiModelStatus.className = `model-status ${status}`;
  geminiModelStatus.textContent = text;
}

export async function validateModelField() {
  const value = geminiModel.value.trim();
  if (!value) {
    setModelStatus('neutral', 'Leave empty for automatic model selection.');
    return;
  }
  setModelStatus('neutral', 'Checking…');
  try {
    const status = await window.api.validateGeminiModel(value);
    setModelStatus(status.ok ? 'ok' : 'err', status.message);
  } catch {
    setModelStatus('neutral', 'Could not validate model right now. It will be checked before translating.');
  }
}

let modelValidateTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleModelValidation() {
  if (modelValidateTimer) clearTimeout(modelValidateTimer);
  modelValidateTimer = setTimeout(() => { void validateModelField(); }, 400);
}

export async function populateLanguages() {
  try {
    const data = await window.api.getLanguages();
    inputLanguageSelect.replaceChildren();
    for (const option of data.input) {
      inputLanguageSelect.appendChild(new Option(option.label, option.value));
    }
    translateToSelect.replaceChildren();
    for (const option of data.target) {
      translateToSelect.appendChild(new Option(option.label, option.value));
    }
  } catch {
    inputLanguageSelect.replaceChildren(new Option('Auto Detect', 'auto'));
    translateToSelect.replaceChildren(new Option('English', 'en'));
  }
}

export function wireTranslationControls() {
  copyTranslationBtn.addEventListener('click', async () => {
    const text = translationText.textContent || '';
    if (!text) return;
    try {
      await window.api.copyText(text);
      showToast('Copied!');
    } catch {
      showError('Unable to copy translation');
    }
  });
}
