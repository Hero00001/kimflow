# 10 — The saved microphone is overwritten by whatever is first in the device list

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/settings-form.ts:223`, `src/audio/recorder.ts:70-76`

`runPersist()` copies `micSelect.value` into the settings unconditionally. `populateMics()` only assigns the select value when the stored device is still present, so the select otherwise keeps the first enumerated device.

## Failure scenario

The user's USB microphone is unplugged and the app restarted; the next unrelated settings save silently rewrites the microphone preference to the built-in device, which the user never chose.

## Suggested fix

Only write the microphone when the user changed the selection.

## Test direction

A settings-form test where the stored device is absent from the list.

## Comments
