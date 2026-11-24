# 12 — Widget randomly disappears (renderer crash left an invisible corpse)

Status: done (2026-11-07, user report + audit W4/W9 context)
Type: defect
Severity: HIGH (user-facing)

## Symptom (user report)

The floating flow-bar capsule "randomly closes" when switching focus between
applications or moving between multiple monitors. The app itself keeps
working — only the hovering UI vanishes.

## Root cause (code-traced)

The widget renderer crashes (`render-process-gone`). Transparent, frameless,
always-on-top windows are GPU-crash-prone during display mode changes and
focus switches on multi-monitor Windows — exactly the reported scenario.

The recovery (`widget-window.cjs`) reloaded the page but **gave up after 3
crashes within 30 s and then left the window alive, blank, and invisible** —
indistinguishable from "the widget closed". Every failure was silent: no log
on the crash, no log on a failed `loadFile` (audit finding W4). Nothing ever
recovered the widget afterwards.

## Fix

- `render-process-gone` now logs the crash reason and recovery attempt.
- When the reload cap trips, the window is **recreated from the original
  creation options** instead of being abandoned. A fresh window resets the
  crash counter and re-anchors the capsule. A 30 s recreate cool-down bounds
  a genuinely broken GPU/driver to one recreate per interval.
- `createWidgetWindow` accepts `onCreated(win)` and fires it on EVERY creation
  (initial and recreates); `main.cjs` re-points its `overlayWindow` reference
  through it, so the fresh widget's IPC stays trusted by `assertTrustedSender`
  (without this, a recreated widget's sends would be dropped as untrusted).
- A failed `loadFile` is now logged (W4) instead of shipping an invisible
  widget with zero diagnostics.

## Tests

`test/widget-resilience.test.cjs` updated: 3 crashes → 3 reloads; the 4th
crash destroys the dead window, creates a fresh one, notifies the owner, and
the fresh window recovers on its own; a further crash loop inside the
cool-down cannot spawn endless windows. Full gate: 507/507, tsc clean,
`npm run test:isolated` PASS.
