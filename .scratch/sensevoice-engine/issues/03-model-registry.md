# 03 — Model registry + SenseVoice download

Status: resolved
Blocked by: —

## Task

Generalize `backend/model-download.cjs` with a registry `{ id → { url, sha256, bytes, filename, engine } }`; add SenseVoice-Small (URL/sha256 from ticket 01's answer). Keep temp-file → rename and `download-progress` IPC unchanged; new entries respect `validateModelSize`. Persist download state via the existing `modelDownloaded` mechanism.

## Acceptance

- Download, verify (sha256), and progress reporting work; corrupt download is rejected and retriable.
- Existing whisper download flow is untouched and still passes its tests.

## Comments

- `backend/model-download.cjs`: whisper ggml helpers (`validateModelSize`/`modelFilename`/`modelDownloadUrl`/`modelDownloaded`/`downloadModel`) are byte-for-byte UNTOUCHED. New registry:
  - `MODEL_REGISTRY` map with both entries:
    - `sense-voice-int8` (engine `sherpa-onnx`): url + filename `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`, **sha256 `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e`, bytes 163,002,883** — both computed by downloading the real GitHub asset to a temp dir outside the repo (2026-11-24, ticket 06). Extracts to `~/.kimflow/sherpa-model/sense-voice-int8/` (model.int8.onnx + tokens.txt).
    - `sherpa-runtime-win-x64` (engine `sherpa-runtime`): v2.0.3 win-x64 shared-MT no-tts archive, **sha256 `e1536db1fcd1dde829f3cf26dfdbf60909aee6984983f6cd16b03b1352ac43fc`, bytes 30,850,705**. Extracts to `~/.kimflow/sherpa/` (exe at `bin/sherpa-onnx-offline.exe` with its DLLs beside it in `bin/` — layout verified on this machine).
  - `downloadRegistryEntry(mainWindow, id)`: unique temp staging file → stream with the SAME single `download-progress` channel (kind `'model'`) → byte-count guard → **sha256 verification BEFORE anything goes live** (mismatch throws; corrupt download rejected and retriable, prior extraction untouched) → extraction via the OS `tar -xjf` (Windows ships bsdtar; NO new npm dependency) into the entry's `extractDir` (wiped first so re-downloads never mix) → required-files existence check.
  - `registryHas`/`registryEntry`/`registryModelDir`/`registryDownloaded` helpers; `registryDownloaded` = all `requiredFiles` found recursively under the extract dir (same existence-check mechanism as `modelDownloaded` — no state files).
  - Extraction location documented: runtime → `~/.kimflow/sherpa/`, model → `~/.kimflow/sherpa-model/<id>/`; archives are deleted after successful extraction.
- `main.cjs` `check-model-downloaded`/`download-model` route registry ids (`registryHas`) to the registry flow; whisper sizes keep the original path. The `download-model` handler chains the runtime entry BEFORE the model entry (one click = working engine, one progress bar). Non-win32 registry downloads throw (Windows-only slice).
- `backend/transcribe.cjs` re-exports `registryHas`/`registryDownloaded`/`downloadRegistryEntry`; `backend/engines/sherpa.cjs` consumes the registry for readiness checks.
- Tests: `test/sherpa-registry.test.cjs` — registry shape, unknown-id rejection across all functions, sha256-mismatch rejection (nothing extracted, staging file cleaned), byte-count guard before hashing, and `registryDownloaded` nested-file semantics. The whisper flow keeps `test/model-download.test.cjs` untouched and green.
- Full suite 597/597 green; build green.
