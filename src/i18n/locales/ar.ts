/**
 * Arabic locale (ar) — PROVISIONAL, PENDING NATIVE REVIEW.
 *
 * This file has NOT been reviewed by a native Arabic speaker. It was authored
 * against Microsoft's published Arabic software terminology and cross-checked
 * with shipped Arabic UIs. The user reads Arabic and reviews this file
 * personally before release — see the "تصحيحات" (corrections) section at the
 * bottom of this file, which is reserved for their edits.
 *
 * Each entry carries the English source string in a trailing comment so the
 * file can be reviewed side by side with `en.ts` without opening any code.
 *
 * Typed as Record<LocaleKey, string>: a missing or renamed key fails the build.
 */
import type { LocaleKey } from './en';

export const ar: Record<LocaleKey, string> = {
  // ── Brand ────────────────────────────────────────────────────────────
  'app.name': 'KimFlow', // KimFlow

  // ── Shared ───────────────────────────────────────────────────────────
  'common.copy': 'نسخ', // Copy
  'common.off': 'إيقاف', // Off
  'common.on': 'تشغيل', // On

  // ── Titlebar ─────────────────────────────────────────────────────────
  'titlebar.minimize': 'تصغير', // Minimize
  'titlebar.minimizeAria': 'تصغير النافذة', // Minimize window
  'titlebar.maximize': 'تكبير', // Maximize
  'titlebar.maximizeAria': 'تكبير النافذة', // Maximize window
  'titlebar.close': 'إغلاق', // Close
  'titlebar.closeAria': 'إغلاق النافذة', // Close window

  // ── Sidebar navigation ───────────────────────────────────────────────
  'nav.transcribe': 'النسخ', // Transcribe
  'nav.history': 'السجل', // History
  'nav.settings': 'الإعدادات', // Settings

  // ── Recording status ─────────────────────────────────────────────────
  'status.ready': 'جاهز', // Ready
  'status.recording': 'جارٍ التسجيل', // Recording
  'status.paused': 'متوقف مؤقتًا', // Paused
  'status.transcribing': 'جارٍ النسخ…', // Transcribing…
  'status.pause': 'إيقاف مؤقت', // Pause
  'status.resume': 'استئناف', // Resume
  'status.stop': 'إيقاف', // Stop
  'status.startRecording': 'بدء التسجيل', // Start Recording
  'status.stopRecording': 'إيقاف التسجيل', // Stop Recording

  // ── Transcribe page ──────────────────────────────────────────────────
  'transcribe.transcriptLabel': 'النص المنسوخ', // Transcript
  'transcribe.mic': 'الميكروفون', // Mic
  'transcribe.endSession': 'إنهاء الجلسة', // End Session
  'transcribe.hintStart': 'للبدء', // to start
  'transcribe.hintStop': 'للإيقاف', // to stop
  'transcribe.hintEsc': 'Esc', // Esc
  'transcribe.empty': 'سيظهر النص المنسوخ هنا…\n\nابدأ التحدث للبدء.', // Your transcription will appear here… / Start speaking to begin.

  // ── Translation panel ────────────────────────────────────────────────
  'translation.label': 'الترجمة', // Translation
  'translation.translating': 'جارٍ الترجمة…', // Translating…
  'translation.failed': 'فشلت الترجمة: {error}', // Translation failed: {error}
  'translation.empty': 'في انتظار الترجمة…', // Waiting for a translation…

  // ── History ──────────────────────────────────────────────────────────
  'history.title': 'السجل', // History
  'history.search': 'البحث في السجل…', // Search history…
  'history.searchAria': 'البحث في السجل', // Search history
  'history.clear': 'مسح', // Clear
  'history.emptyTitle': 'لا توجد تسجيلات بعد', // No recordings yet
  'history.emptySub': 'ستظهر النصوص المكتملة هنا.', // Finished transcripts will appear here.
  'history.today': 'اليوم', // Today
  'history.yesterday': 'أمس', // Yesterday
  'history.daysAgo': 'قبل {count} يوم', // {count} days ago
  'history.seconds': '{count} ثانية', // {count} sec
  'history.minutes': '{count} دقيقة', // {count} min
  'history.minutesSeconds': '{minutes} دقيقة {seconds} ثانية', // {minutes} min {seconds} sec

  // ── Settings — headings and section titles ───────────────────────────
  'settings.heading': 'الإعدادات', // Settings
  'settings.section.input': 'الإدخال', // Input
  'settings.section.engine': 'محرّك النسخ', // Transcription engine
  'settings.section.language': 'اللغة والترجمة', // Language & translation
  'settings.section.cleanup': 'تنقية النص', // Text cleanup
  'settings.section.appearance': 'المظهر', // Appearance

  // ── Settings — Input section ─────────────────────────────────────────
  'settings.input.microphone': 'الميكروفون', // Microphone
  'settings.input.mode': 'وضع التسجيل', // Recording Mode
  'settings.input.hotkey': 'مفتاح الاختصار', // Capture Hotkey
  'settings.input.hotkeyAria': 'مفتاح اختصار التسجيل', // Capture hotkey
  'settings.mode.toggle': 'تبديل', // Toggle
  'settings.mode.pushToTalk': 'اضغط للتحدث', // Push-to-Talk
  'settings.hotkey.record': 'تسجيل', // Record
  'settings.hotkey.pressKeys': 'اضغط المفاتيح…', // Press keys…
  'settings.hotkey.placeholder': 'Ctrl+Shift+Space', // Ctrl+Shift+Space

  // ── Settings — Transcription engine section ──────────────────────────
  'settings.engine.label': 'محرّك النسخ', // Engine
  'settings.engine.local': 'Whisper المحلي', // Local Whisper
  'settings.engine.speechmatics': 'Speechmatics', // Speechmatics
  'settings.engine.deepgram': 'Deepgram', // Deepgram
  'settings.engine.whisperModel': 'طراز Whisper', // Whisper Model
  'settings.engine.modelLabel': 'الطراز', // Model
  'settings.engine.advanced': 'متقدّم (ملف تنفيذي مخصّص)', // Advanced (custom binary)
  'settings.engine.download.flavor': 'تنزيل {flavor} (~{size})', // Download {flavor} (~{size})
  'settings.engine.downloading': 'جارٍ تنزيل محرّك {flavor}', // Downloading {flavor} engine
  'settings.engine.suggested': 'موصى به لجهازك: {gpu}', // Suggested for your PC: {gpu}
  'settings.engine.active': '✓ مُفعّل', // ✓ Active
  'settings.engine.incompatible': '✗ غير متوافق', // ✗ Incompatible
  'settings.engine.incompatibleTooltip': 'لا يمكن تشغيل هذا الإصدار على هذا الجهاز', // This build cannot start on this PC
  'settings.engine.useFlavor': 'استخدام {flavor} (~{size})', // Use {flavor} (~{size})
  'settings.engine.installed': 'تم تثبيت المحرّك ✓', // Engine installed ✓
  'settings.engine.switchedIncompatible': 'تم التبديل — لا يمكن تشغيل هذا الإصدار على هذا الجهاز', // Switched — this build cannot start on this PC

  // ── Settings — Whisper models ────────────────────────────────────────
  'settings.model.tiny': 'Tiny (~75 ميغابايت)', // Tiny (~75 MB)
  'settings.model.base': 'Base (~142 ميغابايت)', // Base (~142 MB)
  'settings.model.small': 'Small (~466 ميغابايت)', // Small (~466 MB)
  'settings.model.medium': 'Medium (~1.5 غيغابايت)', // Medium (~1.5 GB)
  'settings.model.nova3': 'Nova 3', // Nova 3
  'settings.model.nova2': 'Nova 2', // Nova 2
  'settings.model.whisperCloud': 'Whisper (سحابي)', // Whisper (Cloud)
  'settings.model.downloading': 'جارٍ تنزيل طراز {model}', // Downloading {model} model

  // ── Settings — model download button ─────────────────────────────────
  'settings.download.download': 'تنزيل', // Download
  'settings.download.downloading': 'جارٍ التنزيل…', // Downloading…
  'settings.download.ready': '✓ جاهز', // ✓ Ready
  'settings.download.retry': 'إعادة المحاولة', // Retry

  // ── Settings — custom binary ─────────────────────────────────────────
  'settings.binary.selectLabel': 'تحديد الملف التنفيذي', // Select Binary
  'settings.binary.notSelected': 'لم يتم التحديد', // Not selected
  'settings.binary.browse': 'استعراض…', // Browse…
  'settings.binary.recheck': 'إعادة الفحص', // Recheck
  'settings.binary.clearTitle': 'مسح الملف التنفيذي المخصّص', // Clear custom binary
  'settings.binary.noneSelected': 'لم يتم تحديد ملف تنفيذي. استخدم «تحديد الملف التنفيذي» أولًا.', // No binary selected. Use Select Binary first.
  'settings.binary.cleared': 'تم مسح الملف التنفيذي المخصّص', // Custom binary cleared

  // ── Settings — API keys ──────────────────────────────────────────────
  'settings.key.apiKey': 'مفتاح API', // API Key
  'settings.key.speechmaticsPlaceholder': 'أدخل مفتاح Speechmatics API', // Enter your Speechmatics API key
  'settings.key.deepgramPlaceholder': 'key-...', // key-...
  'settings.key.geminiKeyPlaceholder': 'AIza...', // AIza...
  'settings.key.removeTitle': 'إزالة المفتاح', // Remove key
  'settings.key.none': 'لا يوجد مفتاح محفوظ', // No key saved
  'settings.key.saved': '🔒 المفتاح محفوظ على هذا الجهاز ✓', // 🔒 Key saved on this device ✓
  'settings.key.volatile': '⚠ المفتاح محفوظ لهذه الجلسة فقط — سيُفقد عند إعادة تشغيل KimFlow', // ⚠ Key held for this session only — it will be lost when KimFlow restarts
  'settings.key.unreadable': '⚠ تعذّر قراءة المفتاح المحفوظ — أعد إدخاله أدناه', // ⚠ Saved key cannot be read — re-enter it below
  'settings.key.unavailable': 'حالة المفتاح غير متاحة', // Key status unavailable
  'settings.key.testConnection': 'اختبار الاتصال', // Test Connection
  'settings.key.testing': 'جارٍ الاختبار…', // Testing…
  'settings.key.connected': '✓ متصل', // ✓ Connected
  'settings.key.connectionSuccessful': 'تم الاتصال بنجاح', // Connection successful
  'settings.key.enterDeepgram': 'أدخل مفتاح Deepgram API أولًا.', // Enter a Deepgram API key first.
  'settings.key.enterSpeechmatics': 'أدخل مفتاح Speechmatics API أولًا.', // Enter a Speechmatics API key first.
  'settings.key.deepgramRemoved': 'تمت إزالة مفتاح Deepgram', // Deepgram key removed
  'settings.key.speechmaticsRemoved': 'تمت إزالة مفتاح Speechmatics', // Speechmatics key removed

  // ── Settings — Text cleanup section ──────────────────────────────────
  'settings.cleanup.speechCleanup': 'تنقية الكلام', // Speech Cleanup
  'settings.cleanup.off': 'إيقاف', // Off
  'settings.cleanup.light': 'خفيفة', // Light
  'settings.cleanup.thorough': 'شاملة', // Thorough
  'settings.cleanup.myWords': 'كلماتي', // My Words
  'settings.cleanup.vocabPlaceholder': 'اسم أو مصطلح واحد في كل سطر، مثال\nKimFlow\nAhmed', // One name or term per line, e.g. / KimFlow / Ahmed
  'settings.cleanup.vocabAria': 'مفردات مخصّصة، مصطلح واحد في كل سطر', // Custom vocabulary, one term per line
  'settings.cleanup.vocabHint': 'الأسماء والمصطلحات التي تقولها كثيرًا — تُرسل إلى المحرّك ليتعرّف عليها بشكل صحيح.', // Names & terms you say often — sent to the engine so it hears them right.
  'settings.cleanup.aiPolish': 'تحسين بالذكاء الاصطناعي', // AI Polish

  // ── Settings — Language & translation section ────────────────────────
  'settings.translation.label': 'الترجمة', // Translation
  'settings.translation.provider': 'مزوّد الترجمة', // Translation Provider
  'settings.translation.providerGemini': 'Gemini', // Gemini
  'settings.translation.inputLanguage': 'لغة الإدخال', // Input Language
  'settings.translation.translateTo': 'الترجمة إلى', // Translate To
  'settings.translation.geminiKey': 'مفتاح Gemini API', // Gemini API Key
  'settings.translation.geminiModel': 'طراز Gemini', // Gemini Model
  'settings.translation.geminiModelPlaceholder': 'gemini-3.6-flash (فارغ = تلقائي)', // gemini-3.6-flash (empty = automatic)
  'settings.translation.geminiModelAria': 'طراز Gemini', // Gemini model
  'settings.translation.modelAuto': 'اتركه فارغًا للاختيار التلقائي للطراز.', // Leave empty for automatic model selection.
  'settings.translation.checking': 'جارٍ التحقق…', // Checking…
  'settings.translation.validateFailed': 'تعذّر التحقق من الطراز الآن. سيتم التحقق منه قبل الترجمة.', // Could not validate model right now. It will be checked before translating.

  // ── Settings — Appearance section ────────────────────────────────────
  'settings.appearance.uiLanguage': 'لغة الواجهة', // UI Language
  'settings.appearance.accent': 'لون التمييز', // Accent Color
  'settings.appearance.accentAria': 'اختيار لون التمييز', // Choose accent color

  // ── Language names (written in their own language) ───────────────────
  'languages.en': 'English', // English
  'languages.ar': 'العربية', // العربية
  'languages.zh': '中文（简体）', // 中文（简体）
  'languages.auto': 'كشف تلقائي', // Auto Detect

  // ── Floating overlay ─────────────────────────────────────────────────
  'overlay.listening': 'يستمع…', // Listening…
  'overlay.widgetAria': 'أدوات KimFlow العائمة', // KimFlow floating controls
  'overlay.dragTitle': 'اسحب لتحريك KimFlow', // Drag to move KimFlow
  'overlay.micAria': 'حالة الميكروفون', // Microphone status
  'overlay.controlsAria': 'أدوات التسجيل', // Recording controls
  'overlay.start': 'بدء التسجيل', // Start recording
  'overlay.pause': 'إيقاف التسجيل مؤقتًا', // Pause recording
  'overlay.resume': 'استئناف التسجيل', // Resume recording
  'overlay.stop': 'الإيقاف والنسخ', // Stop and transcribe
  'overlay.cancel': 'إلغاء التسجيل', // Cancel recording
  'overlay.actionUnavailable': 'الإجراء غير متاح', // Action unavailable

  // ── Toasts ───────────────────────────────────────────────────────────
  'toast.copied': 'تم النسخ!', // Copied!
  'toast.pasteFallback': 'فشل اللصق — تم نسخ النص إلى الحافظة، اضغط Ctrl+V', // Paste failed — text copied to clipboard, press Ctrl+V

  // ── Errors ───────────────────────────────────────────────────────────
  'error.copyTranscript': 'تعذّر نسخ النص', // Unable to copy transcript
  'error.copyTranslation': 'تعذّر نسخ الترجمة', // Unable to copy translation
  'error.loadSettings': 'تعذّر تحميل الإعدادات', // Unable to load settings
  'error.saveSettings': 'تعذّر حفظ الإعدادات', // Unable to save settings
  'error.hotkeyInUse': 'مفتاح الالتقاط هذا مستخدم بالفعل من تطبيق آخر. تم حفظ بقية إعداداتك.', // That capture hotkey is already in use by another app. Your other settings were saved.
  'error.checkModel': 'تعذّر التحقق من الطراز', // Unable to check model
  'error.downloadFailed': 'فشل التنزيل', // Download failed
  'error.engineDownloadFailed': 'فشل تنزيل المحرّك', // Engine download failed
  'error.connectionFailed': 'فشل الاتصال', // Connection failed
  'error.selectBinary': 'تعذّر تحديد الملف التنفيذي', // Unable to select binary
  'error.startRecording': 'تعذّر بدء التسجيل', // Unable to start recording
  'error.transcriptionFailed': 'فشل النسخ', // Transcription failed
  'error.pauseRecording': 'تعذّر إيقاف التسجيل مؤقتًا', // Unable to pause recording
  'error.resumeRecording': 'تعذّر استئناف التسجيل', // Unable to resume recording
  'error.loadHistory': 'تعذّر تحميل السجل', // Unable to load history
  'error.clearHistory': 'تعذّر مسح السجل', // Unable to clear history
  'error.micPermission': 'لم يُمنح إذن الميكروفون', // Microphone permission was not granted
  'error.micUnavailable': 'الوصول إلى الميكروفون غير متاح في نافذة Electron هذه', // Microphone access is unavailable in this Electron window
  'error.unsupportedAudio': 'تنسيق صوت غير مدعوم', // unsupported audio format
  'error.engineStartupFailed': 'فشل المحرّك في فحص بدء التشغيل.', // Engine failed its startup check.
  'error.micBlocked': 'الميكروفون محظور — اسمح بالوصول من إعدادات النظام، ثم أعد المحاولة.', // Microphone blocked — allow access in system settings, then try again.
  'error.micNotFound': 'لم يتم العثور على الميكروفون — تحقق من الاتصال، ثم أعد المحاولة.', // Microphone not found — check connection, then try again.
  'error.micBusy': 'الميكروفون مشغول — أغلق التطبيقات الأخرى التي تستخدمه، ثم أعد المحاولة.', // Microphone is busy — close other apps using it, then try again.
  'error.whisperBinaryNotFound': 'لم يتم العثور على ملف Whisper التنفيذي — استخدم «تحديد الملف التنفيذي» في الإعدادات لتحديد موقع whisper-cli.', // Whisper binary not found — use Select Binary in Settings to locate whisper-cli.
  'error.whisperNotExecutable': 'ملف Whisper التنفيذي غير قابل للتنفيذ — تحقق من الأذونات أو أعد تحديده في الإعدادات.', // Whisper binary is not executable — check permissions or re-select it in Settings.
  'error.whisperModelNotFound': 'لم يتم العثور على طراز Whisper — نزّله من الإعدادات أولًا.', // Whisper model not found — download it in Settings first.
  'error.whisperCrashed': 'تعطّل ملف Whisper التنفيذي — جرّب إصدار CPU فقط أو أعد تثبيت VC++ Redistributable.', // Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.
  'error.invalidApiKey': 'مفتاح API غير صالح — تحقق من الإعدادات وأعد المحاولة.', // Invalid API key — check Settings and try again.
  'error.apiKeyMissing': 'مفتاح API مفقود — أضفه من الإعدادات أولًا.', // API key missing — add it in Settings first.
  'error.network': 'خطأ في الشبكة — تحقق من الاتصال وأعد المحاولة.', // Network error — check connection and retry.
  'error.noSpeech': 'لم يتم اكتشاف كلام — تحقق من مستوى الميكروفون وأعد المحاولة.', // No speech detected — check mic level and try again.
  'error.transcriptionFailedDetail': 'فشل النسخ — راجع التفاصيل وأعد المحاولة.', // Transcription failed — see details and try again.

  // ══════════════════════════════════════════════════════════════════════
  // تصحيحات (Corrections)
  //
  // مساحة محجوزة لك. أضف أي تصحيحات هنا بنفس صيغة المفاتيح أعلاه، مثال:
  //   'settings.cleanup.aiPolish': 'تدقيق ذكي',
  // بعد الانتهاء من المراجعة، انسخ التصحيحات إلى القائمة أعلاه ثم احذفها من هنا.
  // (Reserved for the reviewer's edits. Copy corrections into the list above.)
  // ══════════════════════════════════════════════════════════════════════
};
