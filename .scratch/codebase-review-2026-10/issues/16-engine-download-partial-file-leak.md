# 16 — A failed engine download leaves a partial zip behind on Windows

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`backend/engine-download.cjs:129-132`

On a mid-stream network error the response stream is still open when the catch block calls `fs.unlinkSync(tempDest)`. On Windows an open file cannot be deleted, and the error is swallowed — so a partial zip (up to 273 MB) stays in `~/.kimflow/engines/` forever, and every retry adds another uuid-named leftover.

## Failure scenario

Repeated failed downloads fill the config directory with orphaned partial zips.

## Suggested fix

Destroy the response stream and wait for the writer to close before unlinking.

## Test direction

An engine-download test that fails mid-stream and asserts no zip is left behind.

## Comments
