# KimFlow

KimFlow is a cross-platform desktop dictation application built with Electron, TypeScript, and Vite. It captures speech from a selected microphone, converts the recording to WAV audio, transcribes it locally or through a cloud provider, cleans up the resulting text, and pastes the text into the currently focused application.

KimFlow is designed for fast, keyboard-driven dictation without requiring a browser tab or a hosted account.

## Features

- **Desktop dictation** with a global capture hotkey and an in-app recording button.
- **Local transcription** through a user-supplied `whisper.cpp` executable.
- **Cloud transcription** through:
  - Deepgram prerecorded transcription.
  - Groq's OpenAI-compatible Whisper transcription endpoint.
- **Multilingual speech-to-text** with a configurable input language or automatic language detection.
- **Optional Gemini translation** that translates the finalized transcript into a user-selected target language.
- **Microphone selection** using the Electron renderer's media-device API.
- **Recording controls** for start, pause, resume, stop/transcribe, and cancel.
- **Floating control widget** that can be dragged around the desktop.
- **Recording feedback** with animated voice waves and visible recording state.
- **Accent color customization** while retaining the dark visual theme.
- **Configurable global hotkey** with shortcut recording in Settings.
- **Automatic text cleanup and paste-back** into the focused application.
- **Whisper model download support** for the Small and Medium models.
- **Persistent settings** stored in the user's home directory.
- **Windows, macOS, and Linux packaging targets** through `electron-builder`.

## How It Works

1. KimFlow requests microphone permission from the operating system.
2. The renderer captures audio with `getUserMedia()` and `MediaRecorder`.
3. The recording is converted to 16 kHz, mono, 16-bit WAV audio.
4. The selected transcription engine processes the temporary WAV file.
5. KimFlow cleans up the returned text.
6. The text is displayed in the application and pasted into the focused application.
7. Temporary recording files are removed after processing.

The microphone stream is owned by the main renderer window. The floating widget sends commands to that renderer so that widget controls and the main window use the same recording session.

## Requirements

- **Node.js 18 or newer**. Node 18+ is required by the Deepgram SDK and is recommended for the complete toolchain.
- **npm** (included with Node.js).
- A working microphone and operating-system microphone permission.
- **Electron development dependencies**, installed automatically by `npm install`.
- A `whisper.cpp` executable and downloaded model if using local transcription.
- An API key if using Deepgram or Groq transcription.

The project is primarily developed and packaged on Windows. The Electron configuration also includes macOS and Linux targets, but platform-specific microphone permissions, paste behavior, and packaging requirements may differ.

## Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd kimflow
npm install
```

Replace `<repository-url>` with the URL of your fork or the canonical project repository.

### Local Whisper setup

Local transcription requires both a Whisper model and a compatible `whisper.cpp` executable. KimFlow does not currently bundle the Whisper executable; provide one for your platform.

For local development, place the executable directly in `backend/`:

- Windows: `backend/whisper-cpp.exe`
- macOS/Linux: `backend/whisper-cpp`

For packaged builds, place the platform-specific executable in `backend/bin/` so `electron-builder` can include it:

- Windows: `backend/bin/whisper-cpp.exe`
- macOS/Linux: `backend/bin/whisper-cpp`

Then:

1. Start KimFlow.
2. Open **Settings**.
4. Select **Local** as the transcription engine.
5. Select **Small** or **Medium** under **Model**.
6. Click **Download** and wait for the model download to complete.

Model files are stored in the KimFlow data directory. During development, the local executable is also searched for in `backend/`; packaged builds resolve the executable from the packaged backend locations. Cloud engines do not require the local Whisper executable or model.

## Configuring Transcription Engines

Choose the transcription engine in **Settings**. KimFlow supports three engines:

### Local Whisper

Local Whisper runs on the device and does not require an API key. It requires:

- A compatible `whisper-cpp` executable.
- A downloaded Small or Medium Whisper model.
- Sufficient disk space and system resources for the selected model.

### Deepgram

1. Create a Deepgram API key from the Deepgram console.
2. Open KimFlow and expand **Settings**.
3. Select **Deepgram** as the engine.
4. Paste the key into **Deepgram API Key**.
5. Record and stop the recording to submit the WAV file for transcription.

KimFlow uses Deepgram's prerecorded transcription API with the multilingual `nova-3` model. For **Auto Detect**, the request uses `language=multi` so the dominant spoken language is transcribed in that language; a specific selected language is sent on its own. Language detection is only applied through `nova-3` multilingual — `detect_language` is not used with streaming connections.

### Groq

1. Create a Groq API key from the Groq console.
2. Select **Groq** as the engine.
3. Paste the key into **Groq API Key**.
4. Record and stop the recording.

KimFlow sends the WAV file to Groq's audio transcription endpoint using the `whisper-large-v3-turbo` model.

### Input language

The **Input Language** setting (default: **Auto Detect**) controls which language the selected engine expects or asks the engine to detect automatically. Non-English speech (e.g., Arabic, Chinese, Japanese, French, Spanish, German) is transcribed in its own language rather than forced through an English model.

### Gemini Translation (optional)

Translation is a separate, optional layer that runs **after** transcription. It never replaces the Local Whisper, Groq, or Deepgram engines, and microphone audio is never sent to Gemini — only the finalized transcript text.

1. Open **Settings**.
2. Set **Translation** to **On** (the default is **Off**, which leaves KimFlow behaving exactly as before and makes no Gemini requests).
3. Paste a Gemini API key from Google AI Studio into **Gemini API Key** (in Advanced).
4. Choose an **Input Language** (Auto Detect by default) and a **Translate To** target language (English by default).

The optional **Gemini Model** field (in Advanced) accepts a text-capable model id such as `gemini-3.6-flash`. Leave it empty to use the best available text model automatically. The field validates the entered model against the Gemini API as you type: a ✓/error appears under it. Audio-only Live Translate models (e.g. `gemini-3.5-live-translate-preview`) are **not** supported for transcript translation because they do not accept text input.

When enabled, the transcript is displayed as usual and the translated text appears in the **Translation** panel. Translation runs once per finished transcript, avoiding duplicate requests and unstable partial results. If the Gemini request fails, the transcript is still shown, pasted, and saved; only a translation status is reported.

The translation implementation is isolated in `TranslationService` with a `GeminiTranslationProvider`, so additional providers can be added without touching the transcription pipeline.

### API key storage

API keys (Deepgram, Groq, and Gemini) are saved in the KimFlow settings file as part of the local configuration. Treat the configuration directory as sensitive and do not commit or share it.

- Windows/macOS/Linux: `~/.kimflow/config.json`

Older installations using `~/.typr` are migrated to `~/.kimflow` when KimFlow starts. The migration also attempts to preserve existing model files and other data.

## Running in Development

Start the Vite development server and Electron together:

```bash
npm run electron-dev
```

This command:

- Starts Vite on `http://localhost:1420`.
- Waits for the development server to be ready.
- Launches Electron with the development renderer.

To run only the Vite frontend:

```bash
npm run dev
```

To preview the production frontend in a browser:

```bash
npm run preview
```

The application itself should normally be tested through Electron because microphone permissions, preload APIs, global hotkeys, clipboard behavior, and desktop paste-back are Electron-specific.

## Building and Packaging

### Build the frontend

Run TypeScript validation and create the Vite production output:

```bash
npm run build
```

The compiled renderer is written to `dist/`.

### Run the built application

```bash
npm start
```

`npm start` builds the renderer first and then launches Electron using the packaged-style local files.

### Create an unpacked Electron application

```bash
npm run pack
```

The unpacked application is written to:

```text
dist-electron/
```

### Create a distributable installer/package

```bash
npm run dist
```

The exact output depends on the host operating system and the configured `electron-builder` targets. The current configuration includes:

- Windows: NSIS installer.
- macOS: DMG.
- Linux: AppImage.

The application icon is sourced from `app icon/icon.png` and included in the packaged application files.

## Project Structure

```text
.
├── backend/
│   ├── audio.cjs          WAV validation and audio-buffer handling
│   ├── bin/               Local whisper.cpp executable location
│   ├── cleanup.cjs        Transcript cleanup helpers
│   ├── gemini.cjs         Gemini translation provider
│   ├── history.cjs        Session history storage
│   ├── hotkeys.cjs        Global shortcut registration
│   ├── languages.cjs      Supported language codes for input and translation
│   ├── paste.cjs          Clipboard and platform paste behavior
│   ├── recorder.cjs       Recording state and transcription orchestration
│   ├── settings.cjs       Settings persistence and migration
│   ├── transcribe.cjs     Local, Deepgram, Groq, and model-download logic
│   └── translation.service.cjs  Optional transcript translation facade
├── app icon/
│   └── icon.png           KimFlow application icon
├── src/
│   ├── main.ts            Main renderer UI and microphone workflow
│   ├── overlay.html       Floating microphone widget
│   ├── style.css          Main application theme and layout
│   └── electron.d.ts      Renderer-side Electron API types
├── index.html              Main renderer HTML entry point
├── main.cjs                Electron main process and IPC handlers
├── preload.cjs             Secure context-bridge API
├── package.json             Scripts, dependencies, and electron-builder config
├── tsconfig.json            TypeScript configuration
└── vite.config.ts           Vite development and build configuration
```

## Troubleshooting

### The microphone list is empty

- Confirm that KimFlow has operating-system microphone permission.
- Check that a microphone is connected and available to other applications.
- Restart KimFlow after granting permission.
- Use the default microphone option if a previously selected device has been removed.
- On Windows, check **Settings → Privacy & security → Microphone** and allow desktop applications to access the microphone.

### Recording does not start

- Confirm that the global hotkey is not already registered by another application.
- Try the recording button in the main window.
- Check that the current hotkey contains at least one modifier and a valid key.
- Confirm that microphone permission was granted.
- If using development mode, make sure `npm run electron-dev` is still running.

### Transcription fails with Local Whisper

- Download the selected model from Settings.
- During development, confirm the executable exists in `backend/`; for packaged builds, confirm it is included under `backend/bin/` or available in the expected KimFlow data directory.
- Use the correct executable name for the operating system.
- Ensure the model has finished downloading before recording.
- Try a cloud engine to determine whether the problem is limited to the local Whisper setup.

### Deepgram or Groq reports an API-key error

- Confirm that the correct engine is selected.
- Remove leading/trailing spaces from the key.
- Verify that the key is active and has permission to use the provider's transcription API.
- Confirm that the computer can reach the provider over HTTPS.

### The floating widget is not interactive

- Make sure KimFlow is running as an Electron application rather than only as a Vite browser page.
- Click the visible widget controls rather than the transparent area around the widget.
- Restart the app after upgrading from an older build.
- The widget's center/label area is the drag region; the buttons are intentionally separate interactive regions.

### Transcribed text is not pasted

- Confirm that the target application is focused before stopping transcription.
- Check clipboard permissions and accessibility/input-control permissions for KimFlow on macOS.
- On Linux, install `xdotool` and confirm it is available on `PATH`.
- On Wayland-based Linux desktops, `xdotool` may not work; use an X11 session or adapt `backend/paste.cjs` to the desktop's supported input tool.
- The transcript should still appear in KimFlow even if platform paste-back fails.

### Packaging fails on Windows with an access-denied error

A running `KimFlow.exe` or an antivirus/file-indexing process may be locking files under `dist-electron/`. Close previous packaged instances and run the packaging command again. If necessary, remove the generated `dist-electron/` directory after ensuring no packaged process is running.

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a focused branch:

   ```bash
   git checkout -b feature/your-change
   ```

3. Install dependencies with `npm install`.
4. Make the smallest change that fully addresses the issue.
5. Run the available validation commands:

   ```bash
   npm run build
   node --check main.cjs
   node --check preload.cjs
   ```

6. Test relevant Electron behavior manually, especially microphone permissions, hotkeys, transcription, paste-back, and the floating widget.
7. Update documentation when user-facing behavior or setup changes.
8. Open a pull request describing the problem, implementation, testing performed, and any platform-specific limitations.

Please avoid committing API keys, downloaded model files, generated `dist/` output, packaged installers, or personal KimFlow configuration files.

## License

This repository currently does not contain a root-level `LICENSE` file, so no project license is formally declared yet. Please contact the maintainers before redistributing or using KimFlow in a way that requires explicit licensing terms.

The `package/LICENSE` file belongs to a bundled package and should not be treated as the license for the KimFlow application itself. A project-level license should be added before the first public release.
