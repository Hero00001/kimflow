# 13 — Resuming after a microphone change records silence

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`src/audio/recorder.ts:174-178`, `src/recording.ts:182-183`

`resumeCapture()` calls `mediaRecorder.resume()` on the same recorder and stream that were bound to the unplugged device. Nothing re-runs `getUserMedia`. The comment in `recording.ts` promises "the user can resume on another device", but the implementation does not do that.

## Failure scenario

After a device unplug the app shows "Paused"; the user resumes and speaks into another microphone, but the recorder's source track has ended — the second half of the dictation is silently dropped.

## Suggested fix

Re-acquire the stream on resume when the track has ended, and start a new recorder that appends to the same chunk buffer.

## Test direction

A recorder test that ends the track, resumes, and asserts the new stream is used.

## Comments
