export const statusDot = document.getElementById('status-dot')!;
export const statusText = document.getElementById('status-text')!;
export const statusError = document.getElementById('status-error')!;
export const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
export const recordIconMic = document.getElementById('record-icon-mic')!;
export const recordIconStop = document.getElementById('record-icon-stop')!;
export const hotkeyDisplay = document.getElementById('hotkey-display')!;
export const transcriptText = document.getElementById('transcript-text')!;
export const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
export const micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
export const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
export const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;
export const endBtn = document.getElementById('end-btn') as HTMLButtonElement;
export const micSelect = document.getElementById('mic-select') as HTMLSelectElement;
export const engineGroup = document.getElementById('engine-group')!;
export const localRow = document.getElementById('local-row')!;
export const groqRow = document.getElementById('groq-row')!;
export const deepgramRow = document.getElementById('deepgram-row')!;
export const modelSelect = document.getElementById('model-select') as HTMLSelectElement;
export const downloadBtn = document.getElementById('download-btn') as HTMLButtonElement;
export const downloadProgress = document.getElementById('download-progress')!;
export const progressFill = document.getElementById('progress-fill')!;
export const groqKey = document.getElementById('groq-key') as HTMLInputElement;
export const deepgramKey = document.getElementById('deepgram-key') as HTMLInputElement;
export const modeGroup = document.getElementById('mode-group')!;
export const hotkeyInput = document.getElementById('hotkey-input') as HTMLInputElement;
export const hotkeyRecord = document.getElementById('hotkey-record') as HTMLButtonElement;
export const accentColor = document.getElementById('accent-color') as HTMLInputElement;
export const historySearch = document.getElementById('history-search') as HTMLInputElement;
export const historyList = document.getElementById('history-list')!;
export const historyEmpty = document.getElementById('history-empty')!;
export const clearHistoryBtn = document.getElementById('clear-history-btn') as HTMLButtonElement;
export const translationGroup = document.getElementById('translation-group')!;
export const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
export const inputLanguageSelect = document.getElementById('input-language-select') as HTMLSelectElement;
export const translateToSelect = document.getElementById('translate-to-select') as HTMLSelectElement;
export const geminiKey = document.getElementById('gemini-key') as HTMLInputElement;
export const geminiModel = document.getElementById('gemini-model') as HTMLInputElement;
export const geminiModelStatus = document.getElementById('gemini-model-status')!;
export const translationArea = document.getElementById('translation-area')!;
export const translationText = document.getElementById('translation-text')!;
export const translationError = document.getElementById('translation-error')!;
export const copyTranslationBtn = document.getElementById('copy-translation-btn') as HTMLButtonElement;
export const providerRow = document.getElementById('provider-row')!;
export const translateToRow = document.getElementById('translate-to-row')!;

export const pages = {
  transcribe: document.getElementById('page-transcribe')!,
  history: document.getElementById('page-history')!,
  settings: document.getElementById('page-settings')!,
};
export const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.nav-item'));

export const winMin = document.getElementById('win-min') as HTMLButtonElement;
export const winMax = document.getElementById('win-max') as HTMLButtonElement;
export const winClose = document.getElementById('win-close') as HTMLButtonElement;
