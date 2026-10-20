# 19 — The hotkey restore path claims success even when the restore failed

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`backend/hotkeys.cjs:51-67`

When a new hotkey cannot be registered, the previous one is re-registered but its result is ignored, and `activeHotkey` is set to the previous value regardless.

## Failure scenario

If the old hotkey has since been taken by another application, the app believes it still owns a hotkey while none is registered — the user has no hotkey and no error message.

## Suggested fix

Check the result of the restore and report the failure.

## Test direction

A hotkeys test where both the new and the restored registration fail.

## Comments
