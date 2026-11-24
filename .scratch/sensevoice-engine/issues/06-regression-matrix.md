# 06 — Regression tests + manual matrix

Status: ready-for-human
Blocked by: 05

## Task

Full regression pass for the slice: resolver routing unit tests (already from 02), dispatcher integration test (sherpa selected + zh audio → sherpa path; en audio → whisper path), download-state edge cases, and a manual matrix: {zh, yue, ja, ko, en, ar, auto} × {localEngine: whisper-cpp, sherpa-onnx} × {model downloaded, not downloaded} × {sidecar present, missing/deleted}. Record results as a table in this ticket.

## Acceptance

- No combination hangs, crashes without recovery, or silently drops audio; every fallback path visible in the UI.
- `npm test` fully green; release smoke check on a packaged build (`npm run pack`).
