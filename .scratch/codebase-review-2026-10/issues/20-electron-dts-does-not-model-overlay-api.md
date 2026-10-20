# 20 — electron.d.ts models one full API for both windows

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

src/electron.d.ts:79-119` vs `preload.cjs:54-60`

The `Window` interface declares the full API for every window, but the preload exposes only `overlayAction`, `getRecordingState`, `getSettings`, `onRecordingState` and `onSettingsUpdated` on the overlay page.

## Failure scenario

`src/overlay.ts` compiles against the full surface, so a future call such as `window.api.getHistory()` type-checks and then throws "window.api.getHistory is not a function" at runtime — in the overlay window only.

## Suggested fix

Model the two API surfaces separately and type the overlay against the reduced one.

## Test direction

A type-level test is not possible here; assert the overlay module only uses the reduced API.

## Comments
