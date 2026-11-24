# 08 — B7: Floating widget subsystem (never previously audited)

Status: done (B7 — W7/W8 documented limitations; #14-widget + QA-04 → issues/13; #18-legacy noted)
Type: task
Blocked by: 01
Batch: B7
Depends on: B0
Severity: HIGH

## Implementation notes (2026-11-07)

- **W1 — fixed.** On Linux `isFlowBarWidgetEnabled` now returns false: the
  flow-bar widget (which needs click-through) is replaced by the legacy
  overlay, which owns its small input area. The always-on-top transparent
  capsule can no longer become a permanent click blocker on Linux.
- **W9 — fixed.** The floating window's own `closed` handler now calls
  `destroyWidgetWindow()` — the module-level 16 ms poll and the three screen
  listeners no longer leak when the widget window dies while the app lives.
- **W5 — fixed.** `powerMonitor` suspend/lock-screen calls
  `suspendWidgetPoll()` (poll stopped + forced click-through);
  resume/unlock-screen re-arms it on a visible window.
- **W3 — fixed.** New `capsuleHitRect(state, now)`: within 250 ms of a state
  change the hit box is the UNION of the previous and target capsule rects,
  so clicks can neither pass through a still-visible capsule nor block an
  area that has not grown yet. The poll uses it; the union biases toward
  click-blocking (the safe failure mode).
- **W6 — fixed.** The dead `reduce()`/`TABLE` second state machine is deleted
  from `widget-pure.js` (production never referenced it). Its
  prototype-pollution test duties moved to `toWidgetState`, and two new pins
  assert the state machine STAYS deleted.
- **W4 / A8 — fixed earlier** (widget-crash commit): load failures logged.
- **W2 — fixed in B6** (navigation guards on every window, including widget
  recreations via registerWindowListeners).
- **Deferred, documented:** W7 (partial-clipping rescue) and the legacy
  overlay's first-paint flash (#18 legacy path) stay as known limitations —
  changing them would snap deliberately user-placed capsules; W8 (`d.ts`
  split) → B10; the widget-side cancel button during transcription and
  behavioural `widget.js` execution (QA-04) → issues/13 (the button needs a
  capsule-geometry design decision; QA-04 is partially mitigated by the
  real-launch screenshot smoke).
- **Fail-first proof:** `test/widget-subsystem-b7.test.cjs` — 4/4 fail
  against pre-B7 code, 4/4 pass after.
- Gate: 531/531 tests, `tsc` clean, `test:isolated` PASS.
- **Still unverifiable without a display:** drag, click-through toggling,
  focus stealing, multi-DPI coordinates, sleep/lock runtime behaviour. The
  manual on-screen checklist in the audit remains outstanding for the next
  interactive session.

## Goal

The flow-bar widget was added AFTER the October review. Its own `audit.md` §6 claims the look
was never observed and `widget-shot.cjs` never run — **REFUTED**: six real gitignored PNGs
dated 2026-11-01 exist in `.scratch/flow-bar-widget/shots/`. Drag, click-through and focus
remain genuinely unobserved.

## Findings covered

| ID | Sev | Defect | file:line |
|----|-----|--------|-----------|
| W1 | **HIGH** | `applyIgnoreMouse()` and `startMousePoll()` both `return` on Linux; `setIgnoreMouseEvents` is never called, so the always-on-top transparent 260×64 window stays interactive and swallows every click at bottom-centre forever. The shipped Linux AppImage is affected. The inline comment's rationale is inverted. | `widget-window.cjs:332,349`; `buildWidgetWindowOptions:136` |
| R1 / W9 | **HIGH** | `main.cjs:227` `overlayWindow.on('closed', …)` only nulls the main-process ref; it never calls `destroyWidgetWindow()`. The module-level `widgetWindow`, its 16 ms poll and three `screen` listeners leak until quit. REGRESSION of spec.md §4. | `main.cjs:227`, `widget-window.cjs:67,489,531-550` |
| W3 | MED | Hit-test instantly uses the new `capsuleRectForState()` while the renderer animates `width/height .22s`; clicks can pass through a still-visible capsule or block an area that has not grown yet. | `widget-window.cjs:393`, `widget.css:40` |
| W4 / A8 | MED | `loadFile().catch` only has a comment (no log); `createWidgetWindow` returns no promise and `main.cjs:201` attaches nothing. A missing widget in the asar → window stays `show:false` forever with zero diagnostics. | `widget-window.cjs:512-525`, `main.cjs:201-207` |
| W5 | LOW-MED | 16 ms poll (62.5 wakeups/s, 2 OS calls/tick) never pauses on `powerMonitor` suspend/lock; a stale non-throwing `getCursorScreenPoint()` leaves `cursorInside` sticky → whole-window click-block. | `widget-window.cjs:51,350-353,355-411` |
| W6 | LOW | `reduce()`/`TABLE` is dead code referenced only by tests; the "dev switcher" doc claim is false. | `widget-pure.js:6,56`, `widget.js:164-203` |
| W7 | LOW | Rescue fires only when FULLY off every workArea; `positionWidget()` runs only at load/rescue, so "follows user across monitors" is false. | `widget-window.cjs:198-219,246-286` |
| W8 | LOW | `electron.d.ts` describes one global `fullApi`; `onMicLevel` undeclared, `sendMicLevel` declared for a page that never has it. | `electron.d.ts:80-121`, `widget.js:186` |
| #18 | CHANGED-SHAPE | Transparent-window flash fixed on the default widget path (`show:false` + `showInactive()`); still present on the legacy rollback path. | `widget-window.cjs:124,517`, `overlay-window.cjs:19` |
| QA-04 | HIGH | `src/widget/widget.js` runtime is never executed — only `widget-pure.js` is vm-loaded; markup tests are static regex. | `test/widget-markup*.test.cjs` |

## Affected files

`backend/widget-window.cjs`, `src/widget/*`, `src/overlay.html`, `backend/overlay-window.cjs`,
`main.cjs`, `src/electron.d.ts`, `test/widget-*.test.cjs`, `scripts/widget-shot.cjs`.

## Fail-first tests

1. On simulated Linux → assert `setIgnoreMouseEvents` IS called (or the window is forced to the legacy overlay).
2. Fire a standalone widget `closed` → assert `destroyWidgetWindow()` ran, poll cleared, listeners removed.
3. Reject `loadFile` → assert a logged, surfaced error (not a silent invisible window).
4. vm-load `widget.js` with a fake DOM and assert button clicks / state projection behaviour.

## Acceptance criteria

Linux click-through handled; `closed` tears down the subsystem; hit box tracks the transition;
load failures logged and surfaced; poll pauses on suspend/lock with a stale-cursor timeout;
dead code removed; docstring corrected; widget runtime behaviourally tested.
Manual on-screen verification of drag/click-through/focus remains a separate, explicitly
outstanding item.
