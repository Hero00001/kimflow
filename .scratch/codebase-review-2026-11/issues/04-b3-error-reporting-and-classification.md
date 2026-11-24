# 04 — B3: One error envelope; stop silently swallowing real failures

Status: done (B3)
Type: task
Blocked by: 01
Batch: B3
Depends on: B0
Severity: HIGH

## Implementation notes (2026-11-07)

- **A4 / F-15 — fixed.** `isAbortError` is strictly name/signal-based
  (`signal.aborted`, `AbortError`, axios `CanceledError`); the `/abort/i`
  message match is gone from the classifier, from `utils.ts` and from
  `friendly-errors.cjs`. "Deepgram request aborted by peer (HTTP 502)" now
  surfaces as an error instead of vanishing. The canonical
  `'Transcription aborted'` phrase stays silent in the renderer (exact-match
  only).
- **C1 — fixed.** `errorDetails` returns the raw message instead of
  discarding everything ≤180 chars; `friendly-errors.cjs` `getDetails` likewise.
- **A5 / #21 — fixed.** Both classification tables order disk codes
  (EACCES/ENOSPC/EROFS/disk full/insufficient disk space → new
  `error.storage`) before mic permission, and auth (401/403) before the
  generic "denied". The renderer table also classifies by DOMException name
  (NotAllowedError/NotFoundError/NotReadableError) for renderer-side
  getUserMedia failures. Whisper-spawn EACCES keeps its specific guidance via
  a code+context check ahead of the generic disk rule.
- **A10 — fixed.** AI-polish failures now populate `warnings[]
  ('ai-polish-failed')` in the result payload and render as a toast
  (`warning.aiPolishFailed`, en/ar/zh) in `handleTranscriptionResult`.
- **New: file logging.** `backend/logging.cjs` mirrors all main-process
  console output into `<userData>/logs/kimflow.log` (idempotent install,
  1 MB one-generation rotation, never breaks startup). Wired at the top of
  `whenReady` in `main.cjs` — the packaged app has no terminal, so widget
  crash-recovery and engine diagnostics are finally visible to the user.
- **Deliberate test updates:** locale parity 186→188 keys (two new keys in
  all three locales); `recorder-decisions.test.cjs` message-based abort pins
  inverted — they pinned the A4 defect.
- **Fail-first proof:** `test/error-classification-b3.test.cjs` — 7/10 fail
  against pre-B3 classification code, 10/10 pass after.
- Gate: 517/517 tests, `npx tsc --noEmit` clean, `npm run test:isolated` PASS.

## Goal

Real backend failures must reach the user with an accurate, localised reason. Today identical
errors are regex-matched twice, diagnostics are discarded, and genuine failures are converted
into silent success.

## Findings covered

- **A3 / C1 (HIGH, CODE-TRACED, lead re-verified):** `src/utils.ts:7-12` documents that
  Electron only serialises `error.message`, so the `error.details` branch at `:53` is dead for
  IPC errors. `errorDetails` at `:58` returns `undefined` for every message ≤180 chars —
  i.e. almost all backend errors. Two independent first-match English regex tables exist
  (`src/utils.ts:79-89`, `backend/friendly-errors.cjs:1-20`); `KEY_BY_ENGLISH` (`:33-36`)
  couples translation to backend wording.
- **A4 / F-15 (HIGH, REPRODUCED, lead re-verified):** `recorder-decisions.cjs:24-28`
  `return /abort/i.test(errorMessageText(error))` — `"Deepgram request aborted by peer (HTTP 502)"`
  and `"AbortController timeout in SDK connect"` classify as user cancellation, so the whole
  dictation disappears with zero error. `src/utils.ts:91` ALSO returns `''` for any message
  containing "abort", suppressing it a second time in the UI.
- **A5 (HIGH, REPRODUCED):** `EACCES: permission denied, open temp_recording_x.wav` matches
  `src/utils.ts:80` → `"Microphone blocked"`; `ENOSPC` gets a generic fallback. The user is
  sent to fix the wrong thing.
- **#21 (HIGH):** `/permission|denied/` at `:80` precedes `/401|403/` at `:85`, so
  `"403 permission denied"` renders as `error.micBlocked`.
- **A10 (MEDIUM):** `recorder.cjs:213-229` swallows AI-polish failure in `catch {}`; `polished`
  is returned but never rendered; `secrets.cjs:109-133` returns `''` on decrypt failure so a
  corrupt blob is diagnosed as an invalid API key.

## Affected files

`src/utils.ts`, `backend/friendly-errors.cjs`, `backend/recorder-decisions.cjs`,
`backend/recorder.cjs`, `backend/secrets.cjs`, `main.cjs`, `src/recording.ts`,
`backend/errors.cjs` (new), `src/errors.ts` (new), `src/i18n/locales/*.ts`.

## Fail-first tests (must fail against current code)

1. Classification matrix: `isAbortError(new Error('Deepgram request aborted by peer (HTTP 502)'), {aborted:false})` must be `false`.
2. `{code,message,detail}` round-trip through a real `ipcMain.handle` rejection → `errorDetails` returns the detail for a short message.
3. `EACCES`/`ENOSPC`/`EROFS` → disk/permission keys, not `error.micBlocked`; `"403 permission denied"` → `error.invalidApiKey`.
4. AI-polish failure → a visible `warnings[]` entry.

## Acceptance criteria

Introduce one typed `{code, message, detail}` envelope shared by main and renderer; replace
both regex tables with typed codes; carry `detail` explicitly; make abort classification
class/signal-based only (remove `/abort/i`); stop suppressing short diagnostics; render
`warnings[]`. Blocks B4 (state recovery relies on accurate failure signals).
