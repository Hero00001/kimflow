interface Settings {
  microphone: string;
  engine: string;
  whisperModel: string;
  deepgramApiKey: string;
  groqApiKey: string;
  recordingMode: string;
  hotkey: string;
  accentColor: string;
  translationEnabled: boolean;
  translationProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  inputLanguage: string;
  translationTarget: string;
}

interface LanguageOption {
  value: string;
  label: string;
}

interface LanguagesData {
  input: LanguageOption[];
  target: LanguageOption[];
}

interface TranscriptionResult {
  text: string;
  translation: string | null;
  translationError: string | null;
}

interface HotkeyEvent {
  pressed: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

interface HistoryEntry {
  id: string;
  text: string;
  title: string;
  createdAt: number;
  durationMs: number;
}

interface HistoryData {
  sessions: HistoryEntry[];
}

interface Window {
  api: {
    getSettings: () => Promise<Settings>;
    saveSettings: (settings: Settings) => Promise<Settings>;
    listMicrophones: () => Promise<MediaDeviceInfo[]>;
    getLanguages: () => Promise<LanguagesData>;
    getRecordingState: () => Promise<string>;
    checkModelDownloaded: (modelSize: string) => Promise<boolean>;
    downloadModel: (modelSize: string) => Promise<void>;
    toggleRecording: () => Promise<string>;
    startRecording: () => Promise<void>;
    stopRecording: (audioBuffer: ArrayBuffer) => Promise<TranscriptionResult>;
    cancelRecording: () => Promise<void>;
    pauseRecording: () => Promise<void>;
    resumeRecording: () => Promise<void>;
    overlayAction: (action: string) => Promise<void>;
    copyText: (text: string) => Promise<boolean>;
    windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') => Promise<void>;
    getHistory: () => Promise<HistoryData>;
    clearHistory: () => Promise<HistoryData>;
    onHotkeyPressed: (callback: (event: HotkeyEvent) => void) => () => void;
    onRecordingState: (callback: (state: string) => void) => () => void;
    onTranscriptionResult: (callback: (result: TranscriptionResult) => void) => () => void;
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    onOverlayAction: (callback: (action: string) => void) => () => void;
    onSettingsUpdated: (callback: (settings: Settings) => void) => () => void;
    onHistoryUpdated: (callback: (history: HistoryData) => void) => () => void;
  };
}
