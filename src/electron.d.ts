interface Settings {
  microphone: string;
  engine: string;
  whisperModel: string;
  deepgramApiKey: string;
  groqApiKey: string;
  recordingMode: string;
  hotkey: string;
  accentColor: string;
}

interface HotkeyEvent {
  pressed: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
}

interface Window {
  api: {
    getSettings: () => Promise<Settings>;
    saveSettings: (settings: Settings) => Promise<Settings>;
    listMicrophones: () => Promise<MediaDeviceInfo[]>;
    getRecordingState: () => Promise<string>;
    checkModelDownloaded: (modelSize: string) => Promise<boolean>;
    downloadModel: (modelSize: string) => Promise<void>;
    toggleRecording: () => Promise<string>;
    startRecording: () => Promise<void>;
    stopRecording: (audioBuffer: ArrayBuffer) => Promise<string>;
    cancelRecording: () => Promise<void>;
    pauseRecording: () => Promise<void>;
    resumeRecording: () => Promise<void>;
    overlayAction: (action: string) => Promise<void>;
    onHotkeyPressed: (callback: (event: HotkeyEvent) => void) => () => void;
    onRecordingState: (callback: (state: string) => void) => () => void;
    onTranscriptionResult: (callback: (result: string) => void) => () => void;
    onDownloadProgress: (callback: (progress: DownloadProgress) => void) => () => void;
    onOverlayAction: (callback: (action: string) => void) => () => void;
    onSettingsUpdated: (callback: (settings: Settings) => void) => () => void;
  };
}
