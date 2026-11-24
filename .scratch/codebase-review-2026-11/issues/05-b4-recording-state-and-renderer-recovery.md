# 05 — B4: Recording / mic / state control and renderer recovery

Status: done (B4 — #10 and full stream re-acquire split to issues/13)
Type: task
Blocked by: 01, 04
Batch: B4
Depends on: B0, B3
Severity: HIGH

## Implementation notes (2026-11-07)

- **A2 — fixed.** `render-process-gone` on the main window now logs the crash
  and RELOADS the renderer (bounded: 5 per 60 s, mirroring the widget's
  recovery). The pending floating-action queue is capped at 20, entries carry
  a timestamp and expire after 15 s on replay, and a crash drops the queue
  entirely — no stale start/stop burst into the fresh renderer. `pendingHotkey`
  keeps its single slot (a hotkey pressed while the renderer was dead SHOULD
  fire once after recovery).
- **#09 — fixed.** `persistChain` gained the `.catch`: one rejected runPersist
  surfaces the error and the chain survives; later saves still reach the
  backend. (No dedicated fail-first test — persist() is module-private and
  reachable only through the full settings form; verified by review.)
- **#11 — fixed.** `buttonOwnedSession` flag: push-to-talk pointerleave only
  releases a session the button itself started. A hotkey-started session is
  never stopped by a mouse passing over a button.
- **#12 — fixed.** `devicechange` now diffs the device list against the
  active capture's device: only the actual disappearance of the active input
  (or all inputs when recording `default`) pauses. Plugging in headphones no
  longer interrupts a dictation.
- **#13 — partial→fail-loud.** Resuming on a dead stream now throws a clear
  "Microphone was disconnected" error instead of silently recording silence.
  The audio captured so far is kept. Full re-acquire-on-resume is deferred to
  issues/13 (needs a MediaRecorder chunk-concatenation design).
- **#14 — fixed (main window).** `endBtn` is enabled in every state and
  Escape during TRANSCRIBING triggers cancel — the backend abort path is
  finally reachable during a long transcription. The widget's processing-state
  buttons remain deferred to B7.
- **#24 — fixed.** `beginRecording` reads the microphone from the DOM select
  (the user's visible choice) with the store as fallback, so a mid-edit
  settings broadcast can no longer make the recording use the wrong mic.
- **Fail-first proof:** `test/state-recovery-b4.test.cjs` — 5/5 fail against
  pre-B4 code, 5/5 pass after (harness extended: webContents listener capture).
- Gate: 522/522 tests, `npx tsc --noEmit` clean, `npm run test:isolated` PASS.

## Goal

The user must be able to start, pause, resume, cancel and configure recording without losing
dictation or having settings silently discarded. All 8 prior tickets here are STILL OPEN.

## Findings covered

| # | Defect | Current file:line |
|---|--------|-------------------|
| #09 (HIGH) | `persistChain = persistChain.then(runPersist)` has no `.catch`; one rejection freezes ALL later saves silently | `src/settings-form.ts:346` |
| #10 | `runPersist` copies `micSelect.value` unconditionally, overwriting the saved mic with whatever is first in the device list | `settings-form.ts:352`, `audio/recorder.ts:74-77` |
| #11 (HIGH) | `pointerleave` → `handleTrigger(false)` → `finishRecording()` with no ownership check; a mouse movement cuts off a hotkey-started dictation | `src/recording.ts:149-151` |
| #12 | `devicechange` pauses on ANY device-list change, not just a removed microphone | `audio/recorder.ts:242-256` |
| #13 (HIGH) | `resumeCapture` only calls `mediaRecorder.resume()` on the stale stream; never re-runs `getUserMedia` → silence recorded | `audio/recorder.ts:207-211`, `recording.ts:182-183` |
| #14 (HIGH) | `endBtn` cancel disabled during TRANSCRIBING, Escape ignores it, legacy overlay disables all buttons, widget shows no buttons in `.c-proc` — backend abort path unreachable from any UI | `status.ts:69,95`, `overlay.ts:36`, `widget.css:56-57` |
| #24 (HIGH) | `ownedSettings()` excludes `microphone`; store is replaced wholesale by broadcasts; `beginRecording` reads `store.microphone` not the DOM → records with the wrong mic | `settings-form.ts:94-106`, `recording.ts:36` |
| A2 (HIGH) | Main renderer is a mandatory relay for the global hotkey AND every floating-window action. `render-process-gone` only sets `rendererReady=false`; no reload. `pendingHotkey` is one slot; `pendingOverlayActions` has no cap/TTL and replays as a burst on a later load | `main.cjs:230-237,174-188,557-569,34` |

Also A6 (partial, MEDIUM-HIGH): five competing state holders (`recorder.cjs:21`, `status.ts:16`,
`MediaRecorder.state`, `store.ts:1-9`, `widget.js:59`) with push-only sync and no version/resync.

## Affected files

`src/settings-form.ts`, `src/audio/recorder.ts`, `src/recording.ts`, `src/status.ts`,
`src/overlay.ts`, `src/widget/widget.css`, `src/store.ts`, `src/main.ts`, `main.cjs`.

## Fail-first tests (must fail against current code)

1. Reject one `runPersist` → assert the NEXT save still reaches the backend.
2. `pointerleave` during a hotkey-started session → assert recording continues.
3. Remove/replace a microphone mid-recording → assert resume captures the NEW device.
4. During TRANSCRIBING → assert a reachable cancel control invokes `cancel-recording`.
5. `render-process-gone` → assert the main window is reloaded and pending action queues are
   bounded/expired (no stale burst replay).
6. Mid-edit `settings-updated` → assert the next recording uses the DOM-selected microphone.

## Acceptance criteria

`.catch` on `persistChain`; ownership-checked trigger release; device-change diffing;
re-acquire stream on resume; a visible cancel control during transcription; one authoritative
microphone value; renderer crash recovery + bounded/expiring pending queues.
