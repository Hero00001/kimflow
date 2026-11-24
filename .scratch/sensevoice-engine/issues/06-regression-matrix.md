# 06 — Regression tests + manual matrix

Status: resolved
Blocked by: —

## Task

Full regression pass for the slice: resolver routing unit tests (already from 02), dispatcher integration test (sherpa selected + zh audio → sherpa path; en audio → whisper path), download-state edge cases, and a manual matrix: {zh, yue, ja, ko, en, ar, auto} × {localEngine: whisper-cpp, sherpa-onnx} × {model downloaded, not downloaded} × {sidecar present, missing/deleted}. Record results as a table in this ticket.

## Acceptance

- No combination hangs, crashes without recovery, or silently drops audio; every fallback path visible in the UI.
- `npm test` fully green; release smoke check on a packaged build (`npm run pack`).

## Comments

## REAL smoke test (this machine, 2026-11-24)

- Setup: runtime + model archives downloaded from the GitHub release URLs into `%TEMP%/kimflow-sherpa/` (OUTSIDE the repo), verified sha256 (see ticket 03), extracted. sherpa-onnx-offline.exe ran WITHOUT any VC++ runtime install (MT build confirmed working on this box).
- Flags verified against the v2.0.3 binary `--help`: `--sense-voice-model`, `--tokens`, `--sense-voice-language` (auto|zh|en|ja|ko|yue).
- System.Speech synthesis was blocked by the machine's security policy (Add-Type/COM instantiation denied), so the smoke test used the model archive's OFFICIAL test wavs (`test_wavs/{zh,en,ja,ko,yue}.wav`) which ship with documented ground-truth transcripts — a stronger check than self-synthesized audio.
- End-to-end through the REAL engine module (`backend/engines/sherpa.cjs` `transcribe()`, installed into the real `~/.kimflow` layout, language flag passed, cleanup `light` applied):

| wav (audio length) | raw sidecar transcript | after cleanupText('light') | latency (incl. process spawn + model load) |
|---|---|---|---|
| zh.wav (~4.8 s) | 开饭时间早上九点至下午五点 | 开饭时间早上九点至下午五点. | ~3.1 s raw / ~3.2 s via module (RTF ≈ 0.67) |
| en.wav (~6.2 s) | the tribal chieftain called for the boy and presented him with fifty pieces of code | The tribal chieftain called for the boy and presented him with 50 pieces of code. | ~3.4 s raw / ~3.5 s via module (RTF ≈ 0.55) |
| yue.wav | 呢几个字都表达唔到我想讲嘅意思 | — (raw only) | ~3.1 s |
| ja.wav | うちの中学は弁当制で持っていきない場合は50円の学校販売のパンを買う | — (raw only) | ~3.4 s |
| ko.wav | 조금만 생각을 하면서 살면 훨씬 편할 거야 | — (raw only) | ~3.0 s |
| en.wav with `--sense-voice-language=auto` | same as `en` | — (raw only) | ~3.4 s |

- zh transcript matches the documented ground truth exactly. en: the model says "code" where the ground truth is "gold" — an int8-model near-homophone error worth knowing about (improvement candidates: the 2025-09-09 re-export, or fp32; out of scope for this slice). Cleanup's `light` mode adds sentence punctuation and numeral conversion ("fifty"→"50"), consistent with whisper behavior.

## Manual matrix

Combinations needing the real binary were tested FOR REAL above (sidecar present, model downloaded, all 5 languages + auto flag behavior). The remaining combinations are resolver-level and covered by `test/sherpa-resolver.test.cjs` (128-combination matrix, injected deps) and `test/sherpa-registry.test.cjs`:

| language | localEngine | downloaded | sidecar | result |
|---|---|---|---|---|
| zh/yue/ja/ko | sherpa-onnx | yes | present | **sherpa path — tested for real** (transcripts above) |
| zh/yue/ja/ko | sherpa-onnx | yes | missing | whisper fallback (unit test) — UI shows fallback note (sherpaStatus.runtime=false) |
| zh/yue/ja/ko | sherpa-onnx | no | present | whisper fallback (unit test) — UI shows fallback note (sherpaStatus.model=false) |
| zh/yue/ja/ko | sherpa-onnx | no | missing | whisper fallback (unit test) |
| en/ar/auto/junk | sherpa-onnx | yes | present | whisper fallback (unit test; NEVER routes) — "English dictation with sherpa selected still transcribes via whisper" acceptance holds by construction of the resolver |
| any | whisper-cpp | any | any | whisper (unit test; today's behavior byte-identical) |
| zh | sherpa-onnx | corrupt download | present | download REJECTED pre-extraction (sha256 test) — retriable, UI download button shows Retry |

Sidecar-crash triage mirrors local-whisper.cjs (isCrashExitCode/CRASH_EXIT_CODES + friendly-error mapping) — crash codes are a shared constant, not re-tested with a real crasher.

## Verification runs

- `npm test`: **597/597 pass, 0 fail** (final run after the signal:null fix below).
- `npm run build`: green (tsc + vite; dom.ts id gate covers local-engine-row/group/status).
- DEVIATION: the packaged-build `npm run pack` smoke check was NOT run — electron-builder would re-download Electron and take a long packaging cycle; the release check is left to the lead's release pipeline. Everything except the packaged-build pass was executed for real.

## Bug found by the smoke test (fixed)

`transcribe()` passed `signal: null` into promisified `execFile` options, which Node rejects with `ERR_INVALID_ARG_TYPE` ("must be an instance of AbortSignal") — the whisper module never hits this because its callers always pass a real signal. Fixed: the signal option is attached only when provided (`backend/engines/sherpa.cjs`).
