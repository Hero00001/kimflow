# 08 — Sentence-case copy pass

Status: resolved
Blocked by: —

## Task

Audit `data-i18n` strings in `index.html` and the `src/i18n` bundles for Title Case fragments and inconsistent punctuation; convert to sentence case ("Open settings", "Stop & transcribe" style). Pure string edits — no layout or id changes. Keep proper nouns capitalized.

## Acceptance

- No Title Case labels remain in the settings/main surfaces; i18n parity test still green.

## Comments

- `src/i18n/locales/en.ts`: 20+ labels converted to sentence case — Start/Stop recording, End session, Recording mode, Capture/Pause hotkey, Push-to-talk, Whisper model, Select binary, API key, Test connection, Speech cleanup, My words, AI polish, Translation provider, Input language, Translate to, Gemini API key/model, UI language, Accent color, Auto detect, warning.aiPolishFailed. Proper nouns (KimFlow, Whisper, Deepgram, Speechmatics, Gemini, Nova, Tiny/Base/Small/Medium, Esc) untouched.
- The trailing English review comments in `ar.ts`/`zh.ts` were updated to the new wording (comment-only, values untouched) so the native reviewer sees current source text.
- Mirror invariant kept: the en value of `error.whisperBinaryNotFound` must match the backend diagnostic character-for-character, so `backend/friendly-errors.cjs` and `backend/engines/local-whisper.cjs` were updated ("Select Binary" → "Select binary") along with the exact-string assertion in `test/friendly-errors.test.cjs` (deviation from "pure string edits in i18n" — required to keep the exact-match re-render working).
- No ids, markup, or layout touched; `i18n-markup`, parity, and full suite all green.

### Fix (2026-11-24)

- `backend/friendly-errors.cjs`: the two sherpa.cjs error strings were captured by generic rules — "SenseVoice model not found …" by `/model not found/` → the Whisper message, and "SenseVoice sidecar not found — sherpa-onnx-offline is not installed." by `/offline/` (binary name!) → the network message. Two SenseVoice rules added ABOVE the generic model/network rules; the sidecar case now returns 'SenseVoice runtime not found — download it in Settings first.' Cases added to `test/friendly-errors.test.cjs` using the exact strings sherpa.cjs throws.
- Mirror invariant honored: added `error.senseVoiceModelNotFound` / `error.senseVoiceRuntimeNotFound` to en.ts (values match friendlyMessageFor character-for-character) with ar/zh translations; key-count tests bumped to 208; the exact-string mirror test in `test/i18n-ipc-errors.test.cjs` extended to 14 cases. The renderer's exact-match re-render now localizes both messages too.
