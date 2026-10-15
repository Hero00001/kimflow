/**
 * English locale — the source of truth for every UI string.
 *
 * This file defines the canonical key set. `ar.ts` and `zh.ts` are typed as
 * `Record<LocaleKey, string>`, so a missing or renamed key is a build error
 * rather than a silent fallback at runtime.
 *
 * Key naming: `<surface>.<section>.<element>` — flat, dot-separated.
 * The fallback rule is: a key missing from the active locale resolves to the
 * English string here. A raw key must never reach the screen.
 *
 * NOTE: every value in the `error.*` group is also the exact English sentence
 * the backend used to build, so switching the UI to English reproduces the
 * previous wording character-for-character.
 */
export const en = {
  // ── Brand ────────────────────────────────────────────────────────────
  'app.name': 'KimFlow',

  // ── Shared ───────────────────────────────────────────────────────────
  'common.copy': 'Copy',
  'common.off': 'Off',
  'common.on': 'On',

  // ── Titlebar (OS chrome; exempt from RTL mirroring) ──────────────────
  'titlebar.minimize': 'Minimize',
  'titlebar.minimizeAria': 'Minimize window',
  'titlebar.maximize': 'Maximize',
  'titlebar.maximizeAria': 'Maximize window',
  'titlebar.close': 'Close',
  'titlebar.closeAria': 'Close window',

  // ── Sidebar navigation ───────────────────────────────────────────────
  'nav.transcribe': 'Transcribe',
  'nav.history': 'History',
  'nav.settings': 'Settings',

  // ── Recording status ─────────────────────────────────────────────────
  'status.ready': 'Ready',
  'status.recording': 'Recording',
  'status.paused': 'Paused',
  'status.transcribing': 'Transcribing…',
  'status.pause': 'Pause',
  'status.resume': 'Resume',
  'status.stop': 'Stop',
  'status.startRecording': 'Start Recording',
  'status.stopRecording': 'Stop Recording',

  // ── Transcribe page ──────────────────────────────────────────────────
  'transcribe.transcriptLabel': 'Transcript',
  'transcribe.mic': 'Mic',
  'transcribe.endSession': 'End Session',
  'transcribe.hintStart': 'to start',
  'transcribe.hintStop': 'to stop',
  'transcribe.hintEsc': 'Esc',
  'transcribe.empty': 'Your transcription will appear here…\n\nStart speaking to begin.',

  // ── Translation panel ────────────────────────────────────────────────
  'translation.label': 'Translation',
  'translation.translating': 'Translating…',
  'translation.failed': 'Translation failed: {error}',
  'translation.empty': 'Waiting for a translation…',

  // ── History ──────────────────────────────────────────────────────────
  'history.title': 'History',
  'history.search': 'Search history…',
  'history.searchAria': 'Search history',
  'history.clear': 'Clear',
  'history.emptyTitle': 'No recordings yet',
  'history.emptySub': 'Finished transcripts will appear here.',
  'history.today': 'Today',
  'history.yesterday': 'Yesterday',
  'history.daysAgo': '{count} days ago',
  'history.seconds': '{count} sec',
  'history.minutes': '{count} min',
  'history.minutesSeconds': '{minutes} min {seconds} sec',

  // ── Settings — headings and section titles ───────────────────────────
  'settings.heading': 'Settings',
  'settings.section.input': 'Input',
  'settings.section.engine': 'Transcription engine',
  'settings.section.language': 'Language & translation',
  'settings.section.cleanup': 'Text cleanup',
  'settings.section.appearance': 'Appearance',

  // ── Settings — Input section ─────────────────────────────────────────
  'settings.input.microphone': 'Microphone',
  'settings.input.mode': 'Recording Mode',
  'settings.input.hotkey': 'Capture Hotkey',
  'settings.input.hotkeyAria': 'Capture hotkey',
  'settings.mode.toggle': 'Toggle',
  'settings.mode.pushToTalk': 'Push-to-Talk',
  'settings.hotkey.record': 'Record',
  'settings.hotkey.pressKeys': 'Press keys…',
  'settings.hotkey.placeholder': 'Ctrl+Shift+Space',

  // ── Settings — Transcription engine section ──────────────────────────
  'settings.engine.label': 'Engine',
  'settings.engine.local': 'Local Whisper',
  'settings.engine.speechmatics': 'Speechmatics',
  'settings.engine.deepgram': 'Deepgram',
  'settings.engine.whisperModel': 'Whisper Model',
  'settings.engine.modelLabel': 'Model',
  'settings.engine.advanced': 'Advanced (custom binary)',
  'settings.engine.download.flavor': 'Download {flavor} (~{size})',
  'settings.engine.downloading': 'Downloading {flavor} engine',
  'settings.engine.suggested': 'Suggested for your PC: {gpu}',
  'settings.engine.active': '✓ Active',
  'settings.engine.incompatible': '✗ Incompatible',
  'settings.engine.incompatibleTooltip': 'This build cannot start on this PC',
  'settings.engine.useFlavor': 'Use {flavor} (~{size})',
  'settings.engine.installed': 'Engine installed ✓',
  'settings.engine.switchedIncompatible': 'Switched — this build cannot start on this PC',

  // ── Settings — Whisper models (product names stay Latin) ─────────────
  'settings.model.tiny': 'Tiny (~75 MB)',
  'settings.model.base': 'Base (~142 MB)',
  'settings.model.small': 'Small (~466 MB)',
  'settings.model.medium': 'Medium (~1.5 GB)',
  'settings.model.nova3': 'Nova 3',
  'settings.model.nova2': 'Nova 2',
  'settings.model.whisperCloud': 'Whisper (Cloud)',
  'settings.model.downloading': 'Downloading {model} model',

  // ── Settings — model download button ─────────────────────────────────
  'settings.download.download': 'Download',
  'settings.download.downloading': 'Downloading…',
  'settings.download.ready': '✓ Ready',
  'settings.download.retry': 'Retry',

  // ── Settings — custom binary ─────────────────────────────────────────
  'settings.binary.selectLabel': 'Select Binary',
  'settings.binary.notSelected': 'Not selected',
  'settings.binary.browse': 'Browse…',
  'settings.binary.recheck': 'Recheck',
  'settings.binary.clearTitle': 'Clear custom binary',
  'settings.binary.noneSelected': 'No binary selected. Use Select Binary first.',
  'settings.binary.cleared': 'Custom binary cleared',

  // ── Settings — API keys ──────────────────────────────────────────────
  'settings.key.apiKey': 'API Key',
  'settings.key.speechmaticsPlaceholder': 'Enter your Speechmatics API key',
  'settings.key.deepgramPlaceholder': 'key-...',
  'settings.key.geminiKeyPlaceholder': 'AIza...',
  'settings.key.removeTitle': 'Remove key',
  'settings.key.none': 'No key saved',
  'settings.key.saved': '🔒 Key saved on this device ✓',
  'settings.key.unreadable': '⚠ Saved key cannot be read — re-enter it below',
  'settings.key.unavailable': 'Key status unavailable',
  'settings.key.testConnection': 'Test Connection',
  'settings.key.testing': 'Testing…',
  'settings.key.connected': '✓ Connected',
  'settings.key.connectionSuccessful': 'Connection successful',
  'settings.key.enterDeepgram': 'Enter a Deepgram API key first.',
  'settings.key.enterSpeechmatics': 'Enter a Speechmatics API key first.',
  'settings.key.deepgramRemoved': 'Deepgram key removed',
  'settings.key.speechmaticsRemoved': 'Speechmatics key removed',

  // ── Settings — Text cleanup section ──────────────────────────────────
  'settings.cleanup.speechCleanup': 'Speech Cleanup',
  'settings.cleanup.off': 'Off',
  'settings.cleanup.light': 'Light',
  'settings.cleanup.thorough': 'Thorough',
  'settings.cleanup.myWords': 'My Words',
  'settings.cleanup.vocabPlaceholder': 'One name or term per line, e.g.\nKimFlow\nAhmed',
  'settings.cleanup.vocabAria': 'Custom vocabulary, one term per line',
  'settings.cleanup.vocabHint': 'Names & terms you say often — sent to the engine so it hears them right.',
  'settings.cleanup.aiPolish': 'AI Polish',

  // ── Settings — Language & translation section ────────────────────────
  'settings.translation.label': 'Translation',
  'settings.translation.provider': 'Translation Provider',
  'settings.translation.providerGemini': 'Gemini',
  'settings.translation.inputLanguage': 'Input Language',
  'settings.translation.translateTo': 'Translate To',
  'settings.translation.geminiKey': 'Gemini API Key',
  'settings.translation.geminiModel': 'Gemini Model',
  'settings.translation.geminiModelPlaceholder': 'gemini-3.6-flash (empty = automatic)',
  'settings.translation.geminiModelAria': 'Gemini model',
  'settings.translation.modelAuto': 'Leave empty for automatic model selection.',
  'settings.translation.checking': 'Checking…',
  'settings.translation.validateFailed': 'Could not validate model right now. It will be checked before translating.',

  // ── Settings — Appearance section ────────────────────────────────────
  'settings.appearance.uiLanguage': 'UI Language',
  'settings.appearance.accent': 'Accent Color',
  'settings.appearance.accentAria': 'Choose accent color',

  // ── Language names ───────────────────────────────────────────────────
  // The three UI-language names are written in their own language in every
  // locale (an Arabic speaker sees "العربية", not "Arabic").
  'languages.en': 'English',
  'languages.ar': 'العربية',
  'languages.zh': '中文（简体）',
  'languages.auto': 'Auto Detect',

  // ── Floating overlay ─────────────────────────────────────────────────
  'overlay.listening': 'Listening…',
  'overlay.widgetAria': 'KimFlow floating controls',
  'overlay.dragTitle': 'Drag to move KimFlow',
  'overlay.micAria': 'Microphone status',
  'overlay.controlsAria': 'Recording controls',
  'overlay.start': 'Start recording',
  'overlay.pause': 'Pause recording',
  'overlay.resume': 'Resume recording',
  'overlay.stop': 'Stop and transcribe',
  'overlay.cancel': 'Cancel recording',
  'overlay.actionUnavailable': 'Action unavailable',

  // ── Toasts ───────────────────────────────────────────────────────────
  'toast.copied': 'Copied!',
  'toast.pasteFallback': 'Paste failed — text copied to clipboard, press Ctrl+V',

  // ── Errors ───────────────────────────────────────────────────────────
  // Renderer-side action failures.
  'error.copyTranscript': 'Unable to copy transcript',
  'error.copyTranslation': 'Unable to copy translation',
  'error.loadSettings': 'Unable to load settings',
  'error.saveSettings': 'Unable to save settings',
  'error.checkModel': 'Unable to check model',
  'error.downloadFailed': 'Download failed',
  'error.engineDownloadFailed': 'Engine download failed',
  'error.connectionFailed': 'Connection failed',
  'error.selectBinary': 'Unable to select binary',
  'error.startRecording': 'Unable to start recording',
  'error.transcriptionFailed': 'Transcription failed',
  'error.pauseRecording': 'Unable to pause recording',
  'error.resumeRecording': 'Unable to resume recording',
  'error.loadHistory': 'Unable to load history',
  'error.clearHistory': 'Unable to clear history',
  'error.micPermission': 'Microphone permission was not granted',
  'error.micUnavailable': 'Microphone access is unavailable in this Electron window',
  'error.unsupportedAudio': 'unsupported audio format',
  'error.engineStartupFailed': 'Engine failed its startup check.',

  // Backend-originated messages (matched by the renderer and re-rendered in
  // the active language). The English values match the backend wording.
  'error.micBlocked': 'Microphone blocked — allow access in system settings, then try again.',
  'error.micNotFound': 'Microphone not found — check connection, then try again.',
  'error.micBusy': 'Microphone is busy — close other apps using it, then try again.',
  'error.whisperBinaryNotFound': 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.',
  'error.whisperNotExecutable': 'Whisper binary is not executable — check permissions or re-select it in Settings.',
  'error.whisperModelNotFound': 'Whisper model not found — download it in Settings first.',
  'error.whisperCrashed': 'Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.',
  'error.invalidApiKey': 'Invalid API key — check Settings and try again.',
  'error.apiKeyMissing': 'API key missing — add it in Settings first.',
  'error.network': 'Network error — check connection and retry.',
  'error.noSpeech': 'No speech detected — check mic level and try again.',
  'error.transcriptionFailedDetail': 'Transcription failed — see details and try again.',
} as const;

/** Union of every valid locale key, derived from the English source of truth. */
export type LocaleKey = keyof typeof en;
