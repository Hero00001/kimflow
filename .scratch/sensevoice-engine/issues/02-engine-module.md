# 02 — Engine module backend/engines/sherpa.cjs

Status: ready-for-human
Blocked by: 01

## Task

Implement `backend/engines/sherpa.cjs` mirroring the `deepgram.cjs` resolver contract: `resolveSherpaModel(language, storedModel)` (zh/yue/ja/ko → sense-voice when enabled and downloaded; everything else incl. `auto` → `{ fallback: 'whisper-cpp' }`) and `transcribe(...)` invoking the sidecar via `execFile` with the whisper pattern's timeout and `isCrashExitCode`/`CRASH_EXIT_CODES` triage. Register the engine in the `backend/transcribe.cjs` dispatcher. Vocabulary is NOT passed to SenseVoice (no hotword mechanism).

## Acceptance

- Unit tests cover routing incl. `auto`, unknown languages, and not-downloaded model → whisper fallback.
- Sidecar crash → graceful error surfaced through the existing engine-state UI, never a hang.
