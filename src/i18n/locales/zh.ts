/**
 * Simplified Chinese (zh) locale — PROVISIONAL, PENDING NATIVE REVIEW.
 *
 * Authored without a native reviewer, using the method required by the spec:
 *   1. Standard software terms resolved against Microsoft's published zh-CN
 *      terminology (设置 / 下载 / 搜索 / 清除 / 提供程序 / 模型 / 麦克风).
 *   2. Phrasing aligned with mature, native-reviewed zh-CN locales shipped in
 *      VS Code and Firefox for equivalent UI strings.
 *   3. An adversarial critique pass hunting for text that "reads like a
 *      translation" rather than native Chinese.
 *
 * Traps handled deliberately:
 *   - "AI Polish"  → 润色 ("polish" = refine text, NOT 波兰 = Poland).
 *   - "Push-to-Talk" → 按键通话 (Microsoft term).
 *   - "Speech Cleanup" → 语音整理 (cleanup of the transcribed speech).
 *   - "Engine" → 转录引擎 (explicit transcription-engine wording, not bare 引擎).
 *
 * Each entry carries the English source string in a trailing comment so the
 * file can be reviewed side by side with `en.ts`.
 *
 * Typed as Record<LocaleKey, string>: a missing or renamed key fails the build.
 */
import type { LocaleKey } from './en';

export const zh: Record<LocaleKey, string> = {
  // ── Brand ────────────────────────────────────────────────────────────
  'app.name': 'KimFlow', // KimFlow

  // ── Shared ───────────────────────────────────────────────────────────
  'common.copy': '复制', // Copy
  'common.off': '关闭', // Off
  'common.on': '开启', // On

  // ── Titlebar ─────────────────────────────────────────────────────────
  'titlebar.minimize': '最小化', // Minimize
  'titlebar.minimizeAria': '最小化窗口', // Minimize window
  'titlebar.maximize': '最大化', // Maximize
  'titlebar.maximizeAria': '最大化窗口', // Maximize window
  'titlebar.close': '关闭', // Close
  'titlebar.closeAria': '关闭窗口', // Close window

  // ── Sidebar navigation ───────────────────────────────────────────────
  'nav.transcribe': '转录', // Transcribe
  'nav.history': '历史记录', // History
  'nav.settings': '设置', // Settings

  // ── Recording status ─────────────────────────────────────────────────
  'status.ready': '就绪', // Ready
  'status.recording': '录音中', // Recording
  'status.paused': '已暂停', // Paused
  'status.transcribing': '正在转录…', // Transcribing…
  'status.pause': '暂停', // Pause
  'status.resume': '继续', // Resume
  'status.stop': '停止', // Stop
  'status.startRecording': '开始录音', // Start Recording
  'status.stopRecording': '停止录音', // Stop Recording

  // ── Transcribe page ──────────────────────────────────────────────────
  'transcribe.transcriptLabel': '转录文本', // Transcript
  'transcribe.mic': '麦克风', // Mic
  'transcribe.endSession': '结束会话', // End Session
  'transcribe.hintStart': '开始', // to start
  'transcribe.hintStop': '停止', // to stop
  'transcribe.hintEsc': 'Esc', // Esc
  'transcribe.empty': '您的转录文本将显示在这里…\n\n开始说话即可开始。', // Your transcription will appear here… / Start speaking to begin.

  // ── Translation panel ────────────────────────────────────────────────
  'translation.label': '翻译', // Translation
  'translation.translating': '正在翻译…', // Translating…
  'translation.failed': '翻译失败：{error}', // Translation failed: {error}
  'translation.empty': '正在等待翻译…', // Waiting for a translation…

  // ── History ──────────────────────────────────────────────────────────
  'history.title': '历史记录', // History
  'history.search': '搜索历史记录…', // Search history…
  'history.searchAria': '搜索历史记录', // Search history
  'history.clear': '清除', // Clear
  'history.emptyTitle': '暂无录音', // No recordings yet
  'history.emptySub': '完成的转录文本将显示在这里。', // Finished transcripts will appear here.
  'history.today': '今天', // Today
  'history.yesterday': '昨天', // Yesterday
  'history.daysAgo': '{count} 天前', // {count} days ago
  'history.seconds': '{count} 秒', // {count} sec
  'history.minutes': '{count} 分钟', // {count} min
  'history.minutesSeconds': '{minutes} 分 {seconds} 秒', // {minutes} min {seconds} sec

  // ── Settings — headings and section titles ───────────────────────────
  'settings.heading': '设置', // Settings
  'settings.section.input': '输入', // Input
  'settings.section.engine': '转录引擎', // Transcription engine
  'settings.section.language': '语言与翻译', // Language & translation
  'settings.section.cleanup': '文本整理', // Text cleanup
  'settings.section.appearance': '外观', // Appearance

  // ── Settings — Input section ─────────────────────────────────────────
  'settings.input.microphone': '麦克风', // Microphone
  'settings.input.mode': '录音模式', // Recording Mode
  'settings.input.hotkey': '捕获快捷键', // Capture Hotkey
  'settings.input.hotkeyAria': '捕获快捷键', // Capture hotkey
  'settings.mode.toggle': '切换', // Toggle
  'settings.mode.pushToTalk': '按键通话', // Push-to-Talk
  'settings.hotkey.record': '录制', // Record
  'settings.hotkey.pressKeys': '请按下按键…', // Press keys…
  'settings.hotkey.placeholder': 'Ctrl+Shift+Space', // Ctrl+Shift+Space

  // ── Settings — Transcription engine section ──────────────────────────
  'settings.engine.label': '转录引擎', // Engine
  'settings.engine.local': '本地 Whisper', // Local Whisper
  'settings.engine.speechmatics': 'Speechmatics', // Speechmatics
  'settings.engine.deepgram': 'Deepgram', // Deepgram
  'settings.engine.whisperModel': 'Whisper 模型', // Whisper Model
  'settings.engine.modelLabel': '模型', // Model
  'settings.engine.advanced': '高级（自定义二进制文件）', // Advanced (custom binary)
  'settings.engine.download.flavor': '下载 {flavor}（约 {size}）', // Download {flavor} (~{size})
  'settings.engine.downloading': '正在下载 {flavor} 引擎', // Downloading {flavor} engine
  'settings.engine.suggested': '建议用于您的电脑：{gpu}', // Suggested for your PC: {gpu}
  'settings.engine.active': '✓ 已启用', // ✓ Active
  'settings.engine.incompatible': '✗ 不兼容', // ✗ Incompatible
  'settings.engine.incompatibleTooltip': '此版本无法在此电脑上启动', // This build cannot start on this PC
  'settings.engine.useFlavor': '使用 {flavor}（约 {size}）', // Use {flavor} (~{size})
  'settings.engine.installed': '引擎已安装 ✓', // Engine installed ✓
  'settings.engine.switchedIncompatible': '已切换 — 此版本无法在此电脑上启动', // Switched — this build cannot start on this PC

  // ── Settings — Whisper models ────────────────────────────────────────
  'settings.model.tiny': 'Tiny（约 75 MB）', // Tiny (~75 MB)
  'settings.model.base': 'Base（约 142 MB）', // Base (~142 MB)
  'settings.model.small': 'Small（约 466 MB）', // Small (~466 MB)
  'settings.model.medium': 'Medium（约 1.5 GB）', // Medium (~1.5 GB)
  'settings.model.nova3': 'Nova 3', // Nova 3
  'settings.model.nova2': 'Nova 2', // Nova 2
  'settings.model.whisperCloud': 'Whisper（云端）', // Whisper (Cloud)
  'settings.model.downloading': '正在下载 {model} 模型', // Downloading {model} model

  // ── Settings — model download button ─────────────────────────────────
  'settings.download.download': '下载', // Download
  'settings.download.downloading': '下载中…', // Downloading…
  'settings.download.ready': '✓ 就绪', // ✓ Ready
  'settings.download.retry': '重试', // Retry

  // ── Settings — custom binary ─────────────────────────────────────────
  'settings.binary.selectLabel': '选择二进制文件', // Select Binary
  'settings.binary.notSelected': '未选择', // Not selected
  'settings.binary.browse': '浏览…', // Browse…
  'settings.binary.recheck': '重新检查', // Recheck
  'settings.binary.clearTitle': '清除自定义二进制文件', // Clear custom binary
  'settings.binary.noneSelected': '未选择二进制文件。请先使用“选择二进制文件”。', // No binary selected. Use Select Binary first.
  'settings.binary.cleared': '已清除自定义二进制文件', // Custom binary cleared

  // ── Settings — API keys ──────────────────────────────────────────────
  'settings.key.apiKey': 'API 密钥', // API Key
  'settings.key.speechmaticsPlaceholder': '输入您的 Speechmatics API 密钥', // Enter your Speechmatics API key
  'settings.key.deepgramPlaceholder': 'key-...', // key-...
  'settings.key.geminiKeyPlaceholder': 'AIza...', // AIza...
  'settings.key.removeTitle': '移除密钥', // Remove key
  'settings.key.none': '未保存密钥', // No key saved
  'settings.key.saved': '🔒 密钥已保存在此设备上 ✓', // 🔒 Key saved on this device ✓
  'settings.key.volatile': '⚠ 密钥仅保留在本次会话中 — KimFlow 重启后将丢失', // ⚠ Key held for this session only — it will be lost when KimFlow restarts
  'settings.key.unreadable': '⚠ 无法读取已保存的密钥 — 请在下方重新输入', // ⚠ Saved key cannot be read — re-enter it below
  'settings.key.unavailable': '密钥状态不可用', // Key status unavailable
  'settings.key.testConnection': '测试连接', // Test Connection
  'settings.key.testing': '测试中…', // Testing…
  'settings.key.connected': '✓ 已连接', // ✓ Connected
  'settings.key.connectionSuccessful': '连接成功', // Connection successful
  'settings.key.enterDeepgram': '请先输入 Deepgram API 密钥。', // Enter a Deepgram API key first.
  'settings.key.enterSpeechmatics': '请先输入 Speechmatics API 密钥。', // Enter a Speechmatics API key first.
  'settings.key.deepgramRemoved': '已移除 Deepgram 密钥', // Deepgram key removed
  'settings.key.speechmaticsRemoved': '已移除 Speechmatics 密钥', // Speechmatics key removed

  // ── Settings — Text cleanup section ──────────────────────────────────
  'settings.cleanup.speechCleanup': '语音整理', // Speech Cleanup
  'settings.cleanup.off': '关闭', // Off
  'settings.cleanup.light': '轻度', // Light
  'settings.cleanup.thorough': '彻底', // Thorough
  'settings.cleanup.myWords': '我的词汇', // My Words
  'settings.cleanup.vocabPlaceholder': '每行一个名称或术语，例如\nKimFlow\nAhmed', // One name or term per line, e.g. / KimFlow / Ahmed
  'settings.cleanup.vocabAria': '自定义词汇，每行一个术语', // Custom vocabulary, one term per line
  'settings.cleanup.vocabHint': '您经常说出的名称和术语 — 会发送给引擎，以便正确识别。', // Names & terms you say often — sent to the engine so it hears them right.
  'settings.cleanup.aiPolish': 'AI 润色', // AI Polish

  // ── Settings — Language & translation section ────────────────────────
  'settings.translation.label': '翻译', // Translation
  'settings.translation.provider': '翻译服务商', // Translation Provider
  'settings.translation.providerGemini': 'Gemini', // Gemini
  'settings.translation.inputLanguage': '输入语言', // Input Language
  'settings.translation.translateTo': '翻译为', // Translate To
  'settings.translation.geminiKey': 'Gemini API 密钥', // Gemini API Key
  'settings.translation.geminiModel': 'Gemini 模型', // Gemini Model
  'settings.translation.geminiModelPlaceholder': 'gemini-3.6-flash（留空 = 自动）', // gemini-3.6-flash (empty = automatic)
  'settings.translation.geminiModelAria': 'Gemini 模型', // Gemini model
  'settings.translation.modelAuto': '留空以自动选择模型。', // Leave empty for automatic model selection.
  'settings.translation.checking': '正在检查…', // Checking…
  'settings.translation.validateFailed': '目前无法验证模型。翻译前会再次检查。', // Could not validate model right now. It will be checked before translating.

  // ── Settings — Appearance section ────────────────────────────────────
  'settings.appearance.uiLanguage': '界面语言', // UI Language
  'settings.appearance.accent': '强调色', // Accent Color
  'settings.appearance.accentAria': '选择强调色', // Choose accent color

  // ── Language names (written in their own language) ───────────────────
  'languages.en': 'English', // English
  'languages.ar': 'العربية', // العربية
  'languages.zh': '中文（简体）', // 中文（简体）
  'languages.auto': '自动检测', // Auto Detect

  // ── Floating overlay ─────────────────────────────────────────────────
  'overlay.listening': '正在聆听…', // Listening…
  'overlay.widgetAria': 'KimFlow 悬浮控件', // KimFlow floating controls
  'overlay.dragTitle': '拖动以移动 KimFlow', // Drag to move KimFlow
  'overlay.micAria': '麦克风状态', // Microphone status
  'overlay.controlsAria': '录音控件', // Recording controls
  'overlay.start': '开始录音', // Start recording
  'overlay.pause': '暂停录音', // Pause recording
  'overlay.resume': '继续录音', // Resume recording
  'overlay.stop': '停止并转录', // Stop and transcribe
  'overlay.cancel': '取消录音', // Cancel recording
  'overlay.actionUnavailable': '操作不可用', // Action unavailable

  // ── Toasts ───────────────────────────────────────────────────────────
  'toast.copied': '已复制！', // Copied!
  'toast.pasteFallback': '粘贴失败 — 文本已复制到剪贴板，请按 Ctrl+V', // Paste failed — text copied to clipboard, press Ctrl+V

  // ── Errors ───────────────────────────────────────────────────────────
  'error.copyTranscript': '无法复制转录文本', // Unable to copy transcript
  'error.copyTranslation': '无法复制翻译', // Unable to copy translation
  'error.loadSettings': '无法加载设置', // Unable to load settings
  'error.saveSettings': '无法保存设置', // Unable to save settings
  'error.hotkeyInUse': '无法应用捕获快捷键 — 可能已被其他应用占用，或格式无效。其余设置已保存。', // Capture hotkey could not be applied - another application may already use it, or it may be invalid. Your other settings were saved.
  'error.checkModel': '无法检查模型', // Unable to check model
  'error.downloadFailed': '下载失败', // Download failed
  'error.engineDownloadFailed': '引擎下载失败', // Engine download failed
  'error.connectionFailed': '连接失败', // Connection failed
  'error.selectBinary': '无法选择二进制文件', // Unable to select binary
  'error.startRecording': '无法开始录音', // Unable to start recording
  'error.transcriptionFailed': '转录失败', // Transcription failed
  'error.pauseRecording': '无法暂停录音', // Unable to pause recording
  'error.resumeRecording': '无法继续录音', // Unable to resume recording
  'error.loadHistory': '无法加载历史记录', // Unable to load history
  'error.clearHistory': '无法清除历史记录', // Unable to clear history
  'error.micPermission': '未授予麦克风权限', // Microphone permission was not granted
  'error.micUnavailable': '此 Electron 窗口中无法使用麦克风', // Microphone access is unavailable in this Electron window
  'error.unsupportedAudio': '不支持的音频格式', // unsupported audio format
  'error.engineStartupFailed': '引擎未通过启动检查。', // Engine failed its startup check.
  'error.micBlocked': '麦克风被阻止 — 请在系统设置中允许访问，然后重试。', // Microphone blocked — allow access in system settings, then try again.
  'error.micNotFound': '未找到麦克风 — 请检查连接，然后重试。', // Microphone not found — check connection, then try again.
  'error.micBusy': '麦克风正忙 — 请关闭其他正在使用它的应用，然后重试。', // Microphone is busy — close other apps using it, then try again.
  'error.whisperBinaryNotFound': '未找到 Whisper 二进制文件 — 请在设置中使用“选择二进制文件”定位 whisper-cli。', // Whisper binary not found — use Select Binary in Settings to locate whisper-cli.
  'error.whisperNotExecutable': 'Whisper 二进制文件无法执行 — 请检查权限或在设置中重新选择。', // Whisper binary is not executable — check permissions or re-select it in Settings.
  'error.whisperModelNotFound': '未找到 Whisper 模型 — 请先在设置中下载。', // Whisper model not found — download it in Settings first.
  'error.whisperCrashed': 'Whisper 二进制文件崩溃 — 请尝试仅 CPU 版本，或重新安装 VC++ 可再发行组件。', // Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.
  'error.invalidApiKey': 'API 密钥无效 — 请检查设置并重试。', // Invalid API key — check Settings and try again.
  'error.apiKeyMissing': '缺少 API 密钥 — 请先在设置中添加。', // API key missing — add it in Settings first.
  'error.network': '网络错误 — 请检查连接并重试。', // Network error — check connection and retry.
  'error.noSpeech': '未检测到语音 — 请检查麦克风音量并重试。', // No speech detected — check mic level and try again.
  'error.transcriptionFailedDetail': '转录失败 — 请查看详情并重试。', // Transcription failed — see details and try again.
};
