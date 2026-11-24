# 17 — B10 remainder: state owner, IPC schema, god-module splits

Status: ready-for-agent (do AFTER the 1.4.7 release)
Type: task
Batch: B10 (split)
Depends on: 11
Severity: MEDIUM (risk), LOW immediate user impact

## Why split out of 11

The remaining B10 items are invasive refactors with no user-facing gain.
Performing them immediately before the 1.4.7 release maximised regression
risk against 543 green tests, so the release ships first. The new
`test/ipc-contract-b10.test.cjs` pins the entire IPC surface as an exact
set, which makes the deferred refactor SAFE: any channel added/removed/
renamed during the refactor now fails the suite immediately.

## Scope (from ticket 11, steps 2–4 and 6)

1. **Typed IPC schema** (`backend/ipc-schema.cjs`): one table of
   `{channel, direction, windows, args, result}` that generates (or at least
   validates) the `ipcMain.handle` registrations, the `preload.cjs` bridge,
   and `electron.d.ts` — with explicit per-window allow-lists replacing the
   page-path regex in the preload (A9 second half).
2. **SessionStore** (`backend/session-store.cjs`): one authoritative state
   owner `{recorderState, settingsVersion, recordingId}`, versioned
   snapshots, resync on subscribe and on window recovery (A6). Removes the
   renderer's second DEFAULT_SETTINGS copy (`src/main.ts:88-104`) and the
   in-place `getSettings()` mutation.
3. **God-module splits**: `main.cjs` (735 lines) → `backend/ipc/*.cjs`
   groups; `src/settings-form.ts` (813 lines) → form / persistence /
   engine-download modules (C4). `widget-window.cjs` last.
4. **Central "degraded" broadcast** for every window-load/action failure
   (A8), instead of three bare `console.error` sites.
5. Remove the inert prod overlay fallback only after the packaging contract
   test has guarded it for a release cycle (A7 second half).

## Acceptance

548+ tests and `tsc` green after EACH split (one split per commit); the
channel-inventory test unchanged (same 28+1+9 channel sets); no behaviour
change; clean-build smoke renders both windows.
