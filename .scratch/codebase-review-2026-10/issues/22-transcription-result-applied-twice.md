# 22 — The transcription result is applied twice in the main renderer

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`main.cjs:380` and `src/recording.ts:65-70`

`main.cjs` broadcasts `transcription-result` to the windows AND returns the same object to the renderer that invoked `stop-recording`. The renderer applies the returned value in `finishRecording` and also applies the broadcast in `handleTranscriptionResult`.

## Failure scenario

`showTranscript`, `showTranslation` and the paste-fallback toast all run twice per dictation. Currently harmless because they are idempotent, but it is one event handled twice.

## Suggested fix

Deliver the result once — either by broadcast only, or by the invoke return only.

## Test direction

A recording test asserting the transcript is applied once.

## Comments
