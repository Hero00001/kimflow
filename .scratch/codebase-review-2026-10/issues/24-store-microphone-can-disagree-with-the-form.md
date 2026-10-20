# 24 — The shared store can hold a different microphone than the settings form shows

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/settings-form.ts:110` (setOwnedSettings), `src/audio/recorder.ts:73`, `src/recording.ts:36`

`runPersist` reads the microphone from the DOM, but the STORE keeps the value from the broadcast snapshot until the next save. `beginRecording` -> `startCapture(settings.microphone)` reads the store, not the form.

## Failure scenario

A user who switches microphone and hits record before the save round-trip completes records with the previous microphone.

## Suggested fix

Include the microphone in the set of values the settings form owns, or read the selection from the DOM at record time.

## Test direction

A settings-form test that changes the microphone, applies a broadcast, and asserts the store agrees.

## Comments
