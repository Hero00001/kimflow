# 15 — Pin SHA-256 hashes for whisper model downloads

Status: ready-for-agent
Type: task
Batch: follow-up of B6
Depends on: 07
Severity: MEDIUM

## Defect (N6 / F-16)

`backend/model-download.cjs` verifies only HTTPS + a content-length byte gate
(`total = Number(content-length) || 0`). A chunked response with no
content-length header bypasses the byte gate entirely and a truncated
`ggml-*.bin` is renamed into place — whisper.cpp then crashes on every
dictation until the model is deleted manually. Engine downloads DO verify
SHA-256 (`engine-download.cjs:136`); models do not.

## Fix direction

1. Publish per-model SHA-256 hashes in the same manifest that hosts the
   models (`Hero00001/kimflow-engines`, `backend/engine-manifest.cjs:28`) —
   one line per model size (tiny/base/small/medium).
2. In `model-download.cjs`, stream-sha256 the temp file, compare against the
   manifest hash BEFORE the rename, and reject on mismatch or missing hash.
   Mirror `engine-download.cjs`'s verification structure.
3. Additionally: reject a response with no content-length AND no hash
   available (fail closed).

## Acceptance

Fail-first tests: (a) hash mismatch → temp file deleted, model NOT promoted;
(b) chunked response with no content-length → rejected, never promoted;
(c) valid download still installs. The manifest repo must publish the hashes
first — this ticket is blocked on that upload.
