# 01 — Speechmatics fetches a transcript before the job is done, and can paste a JSON body as text

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`backend/engines/speechmatics.cjs:74-118`

The poll loop runs until its 120 s deadline and exits **without checking that the job actually reached `done`** — the loop only breaks on `status === 'done'`, so a timeout falls through to the transcript fetch anyway.

The transcript response is then accepted on any 2xx, and when the body is not a string it is `JSON.stringify`d and returned as the transcript.

## Failure scenario

A long recording whose job has not finished yields either an error body or a JSON object, and that JSON is pasted into the user's focused application as if it were the dictation.

## Suggested fix

Track whether the job reached `done`; after the loop, throw a clear timeout error if it did not. Reject a non-string transcript body instead of stringifying it.

## Test direction

A `speechmatics` transcribe test with a stubbed axios that never reports `done`, and one whose transcript endpoint returns an object.

## Comments
