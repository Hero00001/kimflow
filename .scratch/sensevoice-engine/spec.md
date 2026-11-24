# Spec: SenseVoice-Small local engine (sherpa-onnx sidecar)

- Date: 2026-11-24
- Status: awaiting user approval (decisions locked in discussion 2026-11-24)
- Research basis: docs/hex-research-report.md §3; Architect Part B (docs/hex-research-part-b.md)

## Goal

Add exactly ONE new local speech model now: **SenseVoice-Small** (zh, yue, en, ja, ko; ~234 MB ONNX; Apache-2.0) via a **sherpa-onnx sidecar**, so KimFlow gets genuinely good local Chinese dictation with zero change to existing behavior. Everything else (Parakeet, streaming, per-app Modes) stays on the roadmap.

## Locked decisions

- Single model, single runtime: sherpa-onnx sidecar. No node addon (`sherpa-onnx-node`) in this slice — it would need Electron ABI rebuilds and asar unpacking; the sidecar keeps today's CSP posture and crash-triage pattern.
- **English and Arabic stay on whisper.cpp.** The resolver routes only zh/yue/ja/ko dictation to SenseVoice; every other `inputLanguage` falls back to the existing whisper engine, unchanged.
- No streaming in this slice (KimFlow's pipeline is batch post-stop).
- No per-app profiles, no Labs, no other models.
- New settings keys: `localEngine` (`'whisper-cpp' | 'sherpa-onnx'`, default `'whisper-cpp'`) and `sherpaModel` (registry id); added to `normalizeSettings()` whitelist. No new secrets.

## Architecture (mirrors the proven whisper pattern)

1. **Sidecar binary** in `backend/bin/`, resolved via `process.resourcesPath`/`app.asar.unpacked` like the whisper binary; invoked with `execFile`; reuse `isCrashExitCode`/`CRASH_EXIT_CODES` triage from `backend/engines/local-whisper.cjs`.
2. **Engine module** `backend/engines/sherpa.cjs` exporting `resolveSherpaModel(language, storedModel)` — mirrors `deepgram.cjs`'s resolver contract (zh/yue → sense-voice when `localEngine` is sherpa-onnx and the model is downloaded; en/ar/others → `{ fallback: 'whisper-cpp' }`) plus `transcribe(modelId, audioPath, language, signal, polishMode, vocabulary)`. Register in the transcription dispatcher in `backend/transcribe.cjs`.
3. **Model registry** in `backend/model-download.cjs`: `{ id → { url, sha256, bytes, filename, engine } }`; SenseVoice-Small is the first entry (sherpa-onnx release archive `sense-voice-zh-en-ja-ko-yue-2024-07-17`). Keep temp-file → rename + `download-progress` IPC unchanged. New registry entries must pass `validateModelSize`.
4. **UI**: in the merged Speech section, a model select bound to the registry (honest labels: languages + size) reusing `#download-btn`/`checkModelStatus()` mechanics; a missing/incompatible sidecar degrades to whisper.cpp exactly like a missing whisper binary does today.
5. **Vocabulary**: SenseVoice has no hotword mechanism — pass vocabulary only to whisper; do not fake it.

## Risks (from the architect's review)

1. sherpa-onnx Windows prebuilt binaries vs Electron packaging/VC++ runtime — already a known crash class; budget crash triage and a CPU-baseline fallback flavor like whisper's.
2. Verify the exact sherpa-onnx release asset URL/sha256 at implementation time (ticket 01 is a research/spike ticket for exactly this).
3. Arabic and English quality claims must not regress — the resolver's fallback path is covered by regression tests.

## Verification

- Unit tests for `resolveSherpaModel` routing (zh/yue/ja/ko → sense-voice; en/ar/auto/others → whisper fallback; sherpaModel not downloaded → whisper fallback).
- Manual: dictate in Chinese → SenseVoice transcript; dictate in English with `localEngine: sherpa-onnx` → whisper transcript; kill the sidecar binary → graceful fallback + visible engine state.
- `npm test` green.

## Explicit non-goals (this slice)

Parakeet, streaming partials, Qwen3-ASR, Moonshine, Vosk, per-app Modes, CLI, MCP.
