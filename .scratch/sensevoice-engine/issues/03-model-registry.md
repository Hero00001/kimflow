# 03 — Model registry + SenseVoice download

Status: ready-for-human
Blocked by: 02

## Task

Generalize `backend/model-download.cjs` with a registry `{ id → { url, sha256, bytes, filename, engine } }`; add SenseVoice-Small (URL/sha256 from ticket 01's answer). Keep temp-file → rename and `download-progress` IPC unchanged; new entries respect `validateModelSize`. Persist download state via the existing `modelDownloaded` mechanism.

## Acceptance

- Download, verify (sha256), and progress reporting work; corrupt download is rejected and retriable.
- Existing whisper download flow is untouched and still passes its tests.
