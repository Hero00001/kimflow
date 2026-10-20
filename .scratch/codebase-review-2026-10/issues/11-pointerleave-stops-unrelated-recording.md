# 11 — Moving the pointer across the record button stops a recording it never started

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`src/recording.ts:149-151`, `:114-131`

In push-to-talk mode the `pointerleave` handler calls `handleTrigger(false)`, which calls `finishRecording()` — but nothing checks that this button started the session.

## Failure scenario

The user starts dictating with the global hotkey and the pointer merely travels across the record button: `pointerleave` fires and the dictation is cut off mid-sentence.

## Suggested fix

Track whether this button owns the session and only release a session it started.

## Test direction

A recording test that dispatches `pointerleave` while a hotkey-started session is live.

## Comments
