# Typr — Complete Bug Analysis & Fix Plan

## Critical Bugs (App Won't Work)

### 1. `node-microphone` API is completely wrong (`backend/audio.cjs`)
- `Microphone.getDevices()` doesn't exist — the package has no static device enumeration
- Constructor uses `deviceId` but the actual API uses `device` (a string name, not an ID)
- `start()` doesn't exist — the method is `startRecording()`
- `stop()` doesn't exist — the method is `stopRecording()`
- `useDataEmitter` defaults to `false`, so `data` events are NEVER emitted
- Requires SoX (Windows/macOS) or arecord (Linux) installed externally — most users don't have this

### 2. `@deepgram/sdk` v3 API is completely wrong (`backend/transcribe.cjs`)
- `createClient()` is correct, but `deepgram.listen.asyncconnect()` doesn't exist in v3
- The v3 SDK uses `deepgram.listen.prerecorded.transcribeFile()` for file-based transcription
- The response format is also different from what the code expects

### 3. `form-data` package not installed (`backend/transcribe.cjs`)
- Uses `require('form-data')` but it's not in `package.json` dependencies

### 4. `robotjs` API usage is wrong (`backend/paste.cjs`)
- `robot.keyTap('v', 'ctrl')` should be `robot.keyTap('v', ['ctrl'])` — the second arg is an array of modifiers

### 5. `electron-builder` config references wrong filenames (`package.json`)
- `files` array includes `main.js` and `preload.js` but they're now `main.cjs` and `preload.cjs`

### 6. Vite build output not served to Electron (`main.cjs`)
- `main.cjs` loads `index.html` from project root, but after `npm run build`, assets are in `dist/`
- Running `electron .` in dev mode works (Vite dev server), but `npm start` (production) won't find built assets

### 7. `main.cjs` `toggle-recording` handler was truncated
- The handler body was missing in an earlier edit, partially fixed but fragile

### 8. `node-microphone` `data` event emits raw PCM from SoX/arecord, not necessarily 16-bit signed
- Format may not match what the code assumes for WAV writing

### 9. `main.cjs` doesn't expose `startRecording`/`stopRecording` IPC handlers
- The frontend has no way to trigger recording from the UI (only hotkey)

### 10. `preload.cjs` `onRecordingState` uses `ipcRenderer.on` without cleanup
- Memory leak from accumulated listeners

### 11. `transcribe.cjs` `transcribeGroq` uses native `Blob`
- Not available in all Node.js versions; should use the `form-data` npm package properly

### 12. Hotkey normalization incomplete (`backend/hotkeys.cjs`)
- `CmdOrCtrl` replacement only handles the first occurrence
- Electron's `globalShortcut` expects `Command` or `Ctrl` prefix

---

## UI/UX Issues

### 13. No recording start/stop button
- Users can only use the keyboard shortcut

### 14. No transcription result display
- Text is pasted invisibly, user can't see or copy it

### 15. Cluttered sidebar navigation
- Three sections (General, Engine, Recording) with icons and text — too much complexity for a simple dictation app

### 16. Text-heavy settings
- Every row has label + hint + control, too much reading

### 17. No visual feedback during transcription
- Status indicator doesn't show result or errors

### 18. No copy-to-clipboard option
- Text is only pasted, never shown or copyable

---

## Fix Plan (Step-by-Step)

### Phase 1: Fix Audio Capture (Critical)
- **Replace `node-microphone`** with Web Audio API in the renderer process (no native deps, works everywhere)
- Renderer captures audio via `navigator.mediaDevices.getUserMedia` + `MediaRecorder`
- Send audio data to main process via IPC for transcription
- Eliminates SoX/arecord dependency entirely

### Phase 2: Fix Deepgram Integration (Critical)
- Rewrite `transcribeDeepgram()` to use correct v3 SDK API: `deepgram.listen.prerecorded.transcribeFile()`
- Fix response parsing to match v3 SDK format

### Phase 3: Fix Groq Transcription (Critical)
- Replace native `FormData`/`Blob` with the `form-data` npm package properly
- Add `form-data` to `package.json` dependencies

### Phase 4: Fix robotjs (Critical)
- Fix `keyTap('v', ['ctrl'])` syntax
- Add fallback to `osascript` on macOS if robotjs fails

### Phase 5: Fix Electron Build Config (Critical)
- Fix `package.json` `build.files` to reference `main.cjs`, `preload.cjs`
- Fix `main.cjs` to load `dist/index.html` in production
- Add proper `electron-builder` configuration

### Phase 6: Fix IPC and Event Handling
- Add `start-recording` and `stop-recording` IPC handlers
- Fix `preload.cjs` to properly clean up listeners
- Fix hotkey normalization
- Add `transcription-result` event handling in frontend

### Phase 7: Add UI Controls
- Add a prominent "Start/Stop Recording" button
- Add transcription result display area with copy button
- Add status messages for errors

### Phase 8: UI Redesign (Modern, Clean)
- Remove sidebar navigation — use a single-page compact layout
- Replace text-heavy rows with clean icon+label pairs
- Add a large central recording button
- Show transcription result in a scrollable text area
- Use clear visual hierarchy: recording controls at top, settings below
- Add smooth animations and transitions
- Use a clean, modern color scheme with proper spacing