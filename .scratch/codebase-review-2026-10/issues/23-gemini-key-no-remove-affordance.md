# 23 — The Gemini key has no remove affordance, and clearing the field does not delete the stored key

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/settings-form.ts:509`, `backend/secrets.cjs:13-24`

Deepgram and Speechmatics each have a "Remove key" button. The Gemini key has none, and clearing its input only blanks the field: `migratePlaintextKeys` skips an empty value, so the stored key is left in place.

## Failure scenario

A user who wants to revoke the Gemini key from the app has no way to do it, and may believe clearing the field removed it when it did not.

## Suggested fix

Add a remove button for the Gemini key that calls `deleteSecret`, and make an explicitly cleared field delete the stored key.

## Test direction

A settings-form test that removes the Gemini key and asserts `deleteSecret` is called.

## Comments
