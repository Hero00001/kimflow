# Flow-bar widget — Phase 0 audit

Factual record taken before any code changed, plus what this branch touched.
Spec: `dictation-widget-redesign-spec.md`. Branch: `feature/flow-bar-widget`.

## 1. The widget that existed (legacy overlay, still in the repo)

| Concern | File / symbol |
|---|---|
| Window creation | `main.cjs` `createWindows()` — `overlayWindow` is the second `BrowserWindow` |
| Window options | `backend/overlay-window.cjs` `buildOverlayWindowOptions()` — 200×46, transparent, frameless, shadowless |
| Entry resolution | `main.cjs` `getOverlayEntry()` / `loadEntry()` — dev server URL in dev, `dist/src/overlay.html` or `src/overlay.html` on disk |
| Markup + styles | `src/overlay.html` (inline `<style>`), script `/src/overlay.ts` |
| Renderer logic | `src/overlay.ts` — sets `data-state`, sends `overlay-action` |
| Bridge surface | `preload.cjs` `overlayApi` (restricted subset, selected by `isOverlayPage()`) |
| Teardown | `main.cjs` `destroyOverlayWindow()`, called on `mainWindow` close and `will-quit` |

## 2. IPC channels, both directions (unchanged by this work)

**Main → renderer** (`webContents.send`): `recording-state`, `settings-updated`,
`overlay-action`, `hotkey-pressed`, `transcription-result`, `recording-time-limit`,
`history-updated`, `download-progress`.
**Renderer → main** (`ipcRenderer.invoke`): `get-settings`, `save-settings`,
`get-recording-state`, `overlay-action`, `start-recording`, `stop-recording`,
`pause-recording`, `resume-recording`, `cancel-recording`, `toggle-recording`,
`write-clipboard`, `window-control`, `get-history`, `clear-history`,
`list-microphones`, `list-translation-languages`, `validate-gemini-model`,
`check-model-downloaded`, `download-model`, `download-engine`, `activate-engine`,
`engine-status`, `detect-gpu`, `select-whisper-binary`, `check-whisper-binary`,
`test-deepgram-connection`, `test-speechmatics-connection`, `has-secret`,
`secret-state`, `delete-secret`.

**Added by this branch (2, both new — nothing renamed or removed):**

| Channel | Direction | Purpose |
|---|---|---|
| `mic-level` | renderer → main (`send`, one-way) | main window taps its existing analyser, ~30 Hz |
| `widget-level` | main → widget (`send`, one-way) | forwarded level, only while `getState() === 'recording'` |

The widget reuses the existing `overlay-action` invoke channel and the existing
`recording-state` push channel. No recording logic was added: the widget's
`overlayAction` lands in `main.cjs` → `src/main.ts` → `src/recording.ts`
`handleOverlayAction()` → `beginRecording` / `pauseFromOverlay` /
`resumeOverlay` / `finishRecording` / `cancelFromOverlay`.

## 3. State sources

- **Recording state:** `backend/recorder.cjs` `currentState`
  (`ready|recording|paused|transcribing`) is the single source of truth. It is
  pushed with `notify(target, state)` on channel `recording-state` to
  `[mainWindow, overlayWindow]`. The widget only *projects* it
  (`src/widget/widget-pure.js` `toWidgetState`). There is no second state
  machine: `reduce()` is used by the dev switcher and the tests, not by the
  live widget.
- **Accent colour:** `settings.accentColor` (`backend/settings.cjs`,
  `DEFAULT_SETTINGS.accentColor = '#8b5cf6'`, validated by
  `/^#[0-9a-f]{6}$/i`), read by the widget through the read-only
  `get-settings` channel and `settings-updated`.
- **Feature flag:** `useFlowBarWidget`, default `true`, normalized with
  `!== false` so configs predating the key get the widget. Rollback is
  `false` in `~/.kimflow/config.json` or `KIMFLOW_FLOWBAR=0` for one launch.
  There is deliberately no settings-UI toggle (adding i18n keys would break
  the 186-key assertion in `test/i18n-locales.test.cjs`).

## 4. Files added / changed

Added: `src/widget/widget.html`, `src/widget/widget.css`, `src/widget/widget.js`,
`src/widget/widget-pure.js`, `backend/widget-window.cjs`, `scripts/widget-shot.cjs`,
six test files plus `test/helpers/widget-script-loader.cjs`.

Changed: `main.cjs`, `preload.cjs`, `backend/settings.cjs`, `src/electron.d.ts`,
`src/main.ts`, `src/audio/recorder.ts`, `test/helpers/electron-main-harness.cjs`,
`test/overlay-entry.test.cjs` (pins the flag off so its legacy assertions still
test the legacy path).

Untouched on purpose: `backend/overlay-window.cjs`, `src/overlay.html`,
`src/overlay.ts`, `backend/recorder.cjs`, `src/recording.ts`, `vite.config.ts`,
`index.html`, `src/i18n/**`.

## 5. Risks and how they are handled

| Risk | Handling |
|---|---|
| Click-through deadlock: `-webkit-app-region: drag` swallows page mouse events, so the spec's `mouseenter` → `widget:hover` never fires and the capsule could never be clicked or dragged | Click-through is computed in the main process: 16 ms cursor poll → window-local hit test against `capsuleRectForState()` → `setIgnoreMouseEvents(!inside)`. 4 px inflation + 2 agreeing ticks (hysteresis), poll paused 250 ms after `move`/`will-move`, never called on Linux |
| Widget becomes a second state machine | `backend/recorder.cjs` stays authoritative; the widget projects it |
| Widget steals focus | `focusable: false` + `showInactive()` only |
| Orphan window / leaked listeners / leaked timer | `destroyWidgetWindow()` clears the interval, removes the three `screen` listeners (registered per window, never at module scope) and destroys the window; called from `destroyOverlayWindow()` on close and `will-quit` |
| Widget renderer inert over `file://` (the legacy overlay bug) | The widget is a plain static file with only relative `./` subresources, loaded with `loadFile` — identical in dev, `npm start` and the asar |
| Second mic stream | `src/audio/recorder.ts` reuses its existing `AnalyserNode`; no second `getUserMedia`, no second `AudioContext` |
| Untrusted renderer input | `mic-level` uses a non-throwing `isTrustedSender()`; payload must be a finite number and the recorder must be recording; value clamped to 0…1 |
| CSS and `CAPSULE_SIZES` drift | `test/widget-window.test.cjs` parses `--w`/`--h` out of `widget.css` and compares with `CAPSULE_SIZES` |
| Legacy path regression | Flag off is byte-identical; `test/overlay-entry.test.cjs` and `test/overlay-window.test.cjs` still cover it |

## 6. Not verified by this branch

The rendered window. The capsule's look, the drag behaviour and click-through
were not observed on screen — only their inputs (options, geometry, CSS, hit
test maths) are asserted. `scripts/widget-shot.cjs` exists to capture the four
states on a machine with a display; it has not been run here.
