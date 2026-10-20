# 04 — check-whisper-binary is an arbitrary-path existence oracle

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`main.cjs:422-431`

The handler `statSync`s any string the renderer supplies and returns `isFile()`, answering "does this path exist and is it a file" for any path on disk.

## Failure scenario

Any script-injection or XSS in the renderer — or a compromised overlay (see the previous issue) — can enumerate the filesystem one path at a time through a channel that looks like a harmless binary check.

## Suggested fix

Restrict the check to paths the app itself selected, or drop the channel and validate the binary in the main process at the point of use.

## Test direction

A main-process test asserting the handler rejects a path it did not hand out.

## Comments
