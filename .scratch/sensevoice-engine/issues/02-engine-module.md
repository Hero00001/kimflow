# 02 — Engine module backend/engines/sherpa.cjs

Status: resolved
Blocked by: 01

## Task

Implement `backend/engines/sherpa.cjs` mirroring the `deepgram.cjs` resolver contract: `resolveSherpaModel(language, storedModel)` (zh/yue/ja/ko → sense-voice when enabled and downloaded; everything else incl. `auto` → `{ fallback: 'whisper-cpp' }`) and `transcribe(...)` invoking the sidecar via `execFile` with the whisper pattern's timeout and `isCrashExitCode`/`CRASH_EXIT_CODES` triage. Register the engine in the `backend/transcribe.cjs` dispatcher. Vocabulary is NOT passed to SenseVoice (no hotword mechanism).

## Acceptance

- Unit tests cover routing incl. `auto`, unknown languages, and not-downloaded model → whisper fallback.
- Sidecar crash → graceful error surfaced through the existing engine-state UI, never a hang.

## Comments

- `backend/engines/sherpa.cjs` (NEW), mirroring local-whisper.cjs structure:
  - `resolveSherpaModel(language, storedModel, deps)` — deepgram-style resolver contract. Routes `{model:'sense-voice-int8', engine:'sherpa-onnx'}` only for zh/yue/ja/ko when `deps.localEngine === 'sherpa-onnx'` AND sidecar present AND model downloaded; everything else (en, ar, `auto`, unknown junk, non-string) → `{ fallback: 'whisper-cpp' }`. `deps` injects `localEngine`/`modelDownloaded`/`sidecarPresent` for tests; each defaults to the real on-disk check.
  - `transcribe(modelId, audioPath, language, signal, polishMode, vocabulary)` — execFile sidecar, 120s timeout, windowsHide, abort handling, and the whisper pattern's `isCrashExitCode`/`crashErrorMessage`/`friendlyMessageFor` triage re-used from local-whisper.cjs. Vocabulary accepted for dispatcher symmetry but deliberately NOT passed (SenseVoice has no hotword mechanism — spec).
  - CLI flags verified against the v2.0.3 binary's `--help` on this machine: `--sense-voice-model=<model.int8.onnx> --tokens=<tokens.txt> --sense-voice-language=<zh|en|ja|ko|yue>`. The language flag is passed only when concrete (the resolver never routes `auto` here). `--sense-voice-use-itn` left at default (off) — text shaping is owned by the shared cleanup pipeline, like whisper. Output parsing handles the JSON line ({"text": ...}) with a bare-text fallback.
  - Sidecar resolution `resolveSherpaBinary()`: `KIMFLOW_SHERPA_BIN` env override (tests/advanced setups — NO sherpaBinaryPath setting per spec) → recursive search under `~/.kimflow/sherpa/` (where the registry runtime download extracts) → bundled `backend/bin/` → `process.resourcesPath` + `app.asar.unpacked/backend/bin/` (whisper asar pattern).
- `backend/transcribe.cjs`: dispatcher gained `transcribeSherpa` + `resolveSherpaModel` exports.
- `backend/recorder.cjs`: the `local` case routes through `resolveSherpaModel` — sherpa hit → `transcribeSherpa`; `{fallback}` → existing `transcribeLocal` path untouched. Provenance (retheme #04) now tracks the ACTUAL engine/model used (a whisper fallback is never mislabeled as sherpa).
- Test fakes updated (dictation-correctness-b2, error-classification-b3, electron-main-harness) to include the two new dispatcher exports so the harness stub contract stays complete.
- Unit tests: `test/sherpa-resolver.test.cjs` — the full 8-language × 2-localEngine × 2-downloaded × 2-sidecar matrix (128 combinations), stored-model coercion, dispatcher export contract, and output parsing. `test/sherpa-registry.test.cjs` covers registry mechanics (ticket 03).
- Full suite 597/597 green; build green.
