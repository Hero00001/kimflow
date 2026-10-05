# KimFlow UI Rescaling + Friendly Errors — Design Spec
Date: 2026-10-05 | Approach: A (central mapper + flex fix)

## 1. Problem
- Settings `.s-row` / `.model-row` have no wrap or `min-width:0` chain. Long Windows binary paths (e.g. `C:\Users\...\whisper-cli.exe`) push Browse/Recheck off-screen.
- `loadSettingsIntoUi` shows full path while select/recheck show basename — inconsistent, worst after restart.
- Errors surface raw dumps (`stderr`, `exit code`, `ENOENT`, `NotAllowedError`) in `#status-error` / transcript area instead of human sentences.

## 2. Goals / Non-goals
Goals: rows never push buttons off-screen; binary shows `name + ✓/✗` with full path in tooltip; all mic/engine/network/silence failures show one friendly line with details hidden in tooltip/log.
Non-goals: no new error-center UI, no redesign, no new deps.

## 3. Architecture
- CSS-only rescaling fix + TS display unification.
- Single `friendlyError()` normalizer in `src/utils.ts` used by all renderer call sites. Backend keeps raw in `error.details` + `console.error`, top-line `message` made friendly.
- Display reuse: existing `#status-error` + `showError()` with wrapping fix.

## 4. Components / Files
- `src/style.css`: `.s-row{flex-wrap:wrap} + *{min-width:0}`; `.model-row,.api-key-row,.model-field,.hotkey-editor{flex:1 1 auto;min-width:0}`; `.binary-path{min-width:0;flex:1;ellipsis}`; buttons `flex-shrink:0`; `#status-error{white-space:normal;word-break:break-word;min-width:0}`; narrow media query stacks binary row.
- `src/settings-form.ts`: 3 spots unify to `basename + ✓/✗`, set `title=fullPath`.
- `src/utils.ts`: add `friendlyError()` mapping table (mic NotFound/NotAllowed/Overconstrained, decode fail, ENOENT/EACCES, 401/403, network, crash codes, empty transcript). Idempotent.
- `backend/engines/local-whisper.cjs`: friendly top-line, raw `stderr/stdout/exit code` moved to `details`.
- `backend/recorder.cjs`: empty `cleaned` returns `{empty:true}` hint instead of `''`; translation-best-effort unchanged.
- `src/recording.ts`, `src/audio/recorder.ts`: `errorMessage` → `friendlyError`.
- `index.html`: optional `binary-row` class hook only.

## 5. Data flow
Backend `throw Error(friendly + details)` → IPC reject → renderer `friendlyError(err)` → `showError(friendly)` + `title=details` + `console.error(details)`. Silence: `stopRecording → {empty} → showError('No speech detected…')`.

## 6. Error catalog (friendly lines)
- Mic not found / blocked / busy / unsupported; decode fail.
- Whisper binary missing / not executable / crashed; model missing.
- Deepgram/Speechmatics key missing/invalid; network fail; Speechmatics reject.
- Silence / no speech; abort = silent (no error).

## 7. Testing
- `npm test`, `tsc --noEmit` / `vite build`.
- Manual: 120+ char path resize narrow/wide buttons clickable; blocked mic; bad key; silent stop shows hint; crash stderr only in tooltip/console.
