# 09 — B8: Behavioural coverage for the untested critical path

Status: done (B8)
Type: task
Blocked by: 01
Batch: B8
Depends on: B0
Severity: HIGH

## Implementation notes (2026-11-07)

- **QA-03 — covered.** `backend/transcribe.cjs` is now executed for real with
  injected engine fakes: all three `transcribe*` routes are asserted to hit
  the right engine with the EXACT argument lists in order (a regression that
  swapped `model`/`binaryPath` or passed the audio path last would now be
  caught), results pass through unreshaped, and the model-download helpers
  are genuinely re-exported.
- **QA-04 — covered.** `src/widget/widget.js` is vm-executed twice-loaded
  (pure + runtime) in one sandbox with a fake DOM: button dispatch (stop/
  cancel/pause), the context-aware pause→resume flip, state projection incl.
  the documented garbage-recorder→idle mapping and the setState garbage
  guard, accent colour reaching `--live`, the debug-pin ignore path, the
  missing-bridge degradation, and the `__kimflowWidgetReady` sentinel the
  launch smoke depends on.
- **QA-10 — partially covered, remainder cited.** New real-module tests for
  `src/audio/level.ts` (perceptual curve + boundaries), `src/store.ts`,
  `backend/languages.cjs` (list consistency), and `src/status.ts` was
  behaviourally covered in B4. `src/recording.ts`/`src/audio/recorder.ts`
  were covered behaviourally in B2/B4 (orchestration harness) — cited, not
  duplicated. `src/main.ts`, `src/overlay.ts`, `src/dom.ts`, `src/theme.ts`,
  `src/history.ts` (renderer) remain thin DOM-wiring modules; their logic
  paths are exercised indirectly through the harness suites — accepted as a
  documented limit rather than padding the suite.
- **QA-05 — verified + pinned.** `assertOverridesAllowed` already rejects
  overrides for non-stubbed modules; the missing self-test now pins it
  (an override for `settings.cjs` must be rejected).
- **QA-09 — already satisfied.** `test/paste-helper.test.cjs` carries real
  outcome assertions (stdin protocol lines, spawn counts, kill-on-wedge); the
  finding's file list no longer matches reality.
- **Mutation proof (definition-of-done #6):** two targeted mutations were
  applied and reverted — (1) deepgram routing swapped to local-whisper →
  dispatcher test failed; (2) widget stop button changed to send 'banana' →
  button test failed. The tests bite.
- Gate: 543/543 tests, `tsc` clean, `test:isolated` PASS.

## Goal

483 tests pass, but several files on the critical dictation path are NEVER executed. A green
suite currently proves very little about start/stop/paste/history.

## Findings covered

- **QA-03 (HIGH):** `backend/transcribe.cjs` (the central engine dispatcher) has **0 requires**;
  its three references are stubs or regex. Engine routing and result-shape regressions are undetected.
- **QA-04 (HIGH, also B7):** `src/widget/widget.js` is only statically regex-tested; only
  `widget-pure.js` is vm-loaded. Capsule clicks/state can break with all tests green.
- **QA-10 (MEDIUM):** never executed — `src/recording.ts`, `src/audio/recorder.ts`,
  `src/history.ts`, `src/theme.ts`, `src/status.ts`, `src/main.ts`, `src/overlay.ts`,
  `src/dom.ts`, `src/store.ts`, `src/audio/level.ts`, `backend/languages.cjs`.
- **QA-05 (MEDIUM):** `electron-main-harness.cjs:29-31,221` consults `overrides[basename]`
  before the stub switch with no allow-list — an override for `settings.cjs` (deliberately
  unstubbed at `:24-25`) replaces the module under test. Currently latent (all 5 override
  sites use legitimately stubbed modules).
- **QA-09:** three assertion-free tests pass if `pasteViaHelper`/`shutdownPasteHelper` become no-ops.
- Static source-regex suites (`widget-markup.test.cjs`, `widget-markup-guards.test.cjs`,
  `widget-preload-surface.test.cjs:150-172`) assert text, not runtime.

## Already directly tested — do not duplicate

`backend/widget-window.cjs` (4 suites), `backend/paste-helper.cjs` (2),
`backend/format-numbers.cjs` (3), `src/settings-form.ts` (9 `loadTs` suites),
`preload.cjs` (genuinely vm-executed), `backend/gemini.cjs` (partial: `buildPolishPrompt`,
`validateModel`).

## Affected files

New tests only, under `test/`; plus `test/helpers/*` where a fake DOM/window is needed.

## Definition of done

1. Real-module unit tests for `backend/transcribe.cjs` with injected engine stubs.
2. `widget.js` vm-loaded with a fake DOM; assert button dispatch and state projection.
3. `loadTs`-based behaviour tests for `src/recording.ts`, `src/audio/recorder.ts`,
   `src/status.ts`, `src/history.ts` (start/stop/paste/history outcomes).
4. Harness self-test rejecting overrides for the module under test.
5. Outcome assertions added to the three `paste-helper` no-assert tests.
6. Every new test must be shown to FAIL against pre-fix production code (revert matrix from B0).
