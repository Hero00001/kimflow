# 14 — A transcription cannot be cancelled from any UI

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`src/status.ts:69`, `:95`, `src/overlay.ts:36`, `src/recording.ts:209-224`

During `TRANSCRIBING` the main window disables its cancel button, the overlay disables **all** of its buttons including cancel, and the Escape handler only fires for `RECORDING`/`PAUSED`. The backend has a working abort path (`backend/recorder.cjs`, `cancelRecording` -> abort -> `{aborted:true}`).

## Failure scenario

A long local-Whisper transcription cannot be interrupted — the user is locked out of every control until it finishes, even though the backend could abort it.

## Suggested fix

Keep the cancel control enabled while transcribing and route it to `cancelRecording`.

## Test direction

A status test asserting the cancel control stays enabled while transcribing.

## Comments
