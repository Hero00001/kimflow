interface Settings {
  microphone: string;
  engine: string;
  whisperModel: string;
  whisperRuntime: string;
  whisperBinaryPath: string;
  deepgramApiKey: string;
  deepgramModel: string;
  speechmaticsApiKey: string;
  recordingMode: string;
  polishMode: string;
  customVocabulary: string[];
  aiPolish: boolean;
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

interface GeminiModelStatus {
  ok: boolean;
  found?: boolean;
  supportsGenerateContent?: boolean;
  methods?: string[];
  model?: string;
  message: string;
}

interface LanguagesData {
  input: LanguageOption[];
  target: LanguageOption[];
}

interface TranscriptionResult {
  text: string;
  translation: string | null;
  translationError: string | null;
  translating?: boolean;
  pasteFallback: string | null;
  pasteOk: boolean;
  aborted?: boolean;
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
  translation?: string | null;
  translationTarget?: string;
  translationError?: string | null;
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
    validateGeminiModel: (model: string) => Promise<GeminiModelStatus>;
    getRecordingState: () => Promise<string>;
    checkModelDownloaded: (modelSize: string) => Promise<boolean>;
    downloadModel: (modelSize: string) => Promise<void>;
    downloadEngine: (flavor: string) => Promise<string>;
    activateEngine: (flavor: string) => Promise<string>;
    engineStatus: () => Promise<Record<string, 'missing' | 'ready' | 'downloading' | 'incompatible'>>;
    detectGpu: () => Promise<string>;
    selectWhisperBinary: () => Promise<string | null>;
    checkWhisperBinary: (binaryPath: string) => Promise<boolean>;
    testDeepgramConnection: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
    testSpeechmaticsConnection: (apiKey: string) => Promise<{ ok: boolean; message: string }>;
    hasSecret: (name: string) => Promise<boolean>;
    secretState: (name: string) => Promise<'saved' | 'missing' | 'unreadable'>;
    deleteSecret: (name: string) => Promise<boolean>;
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
    onRecordingTimeLimit: (callback: (event: { maxRecordingMs: number }) => void) => () => void;
    onTranscriptionResult: (callback: (result: TranscriptionResult) => void) => () => void;
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    onOverlayAction: (callback: (action: string) => void) => () => void;
    onSettingsUpdated: (callback: (settings: Settings) => void) => () => void;
    onHistoryUpdated: (callback: (history: HistoryData) => void) => () => void;
  };
}
