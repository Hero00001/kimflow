# 05 — History confirmation safety + copy affordance

Status: resolved
Blocked by: —

## Task

- `#clear-history-btn` (src/history.ts `wireHistory()`): first click switches the button to a "Confirm?" state; second click executes; a short timeout or blur reverts. Two-step confirm only — no modal.
- Per-entry delete gets the same two-step confirm pattern.
- Add a per-entry copy affordance (`clipboard.writeText(entry.text)`) using the existing `text-btn` style; keep the entry's click-to-open behavior intact.

## Acceptance

- Single accidental click can no longer wipe history.
- Copy works and never triggers the open action; keyboard reachable.

## Comments

- `src/history.ts`: `#clear-history-btn` is now two-step. First click arms it (label → `history.clearConfirm` = "Click again to clear"); second click executes `clearHistory()`. A 4s timeout or blur disarms. `renderHistory()` re-syncs the label with the armed state so a `renderStatic()` language swap mid-arm can't leave a stale label. No modal.
- Per-entry copy: `renderHistory()` appends a `text-btn history-item-copy` button per entry using `window.api.copyText` (the existing clipboard pattern) + `showToast(t('toast.copied'))`; `stopPropagation` keeps mouse and keyboard activation from triggering entry open. New i18n keys `history.clearConfirm` + `history.copyEntryAria` added to en, ar, AND zh (parity tests updated to 194 keys).
- DEVIATION — per-entry delete confirm: NOT implemented. There is no per-entry delete in the UI today; the backend's `removeSession` is only invoked internally for cancelled dictations and is not exposed over IPC. Per the lead's instruction, no delete flow was invented; only the clear confirm shipped. If per-entry delete is added later (new IPC channel + preload surface), it must reuse this two-step pattern.
- CAVEAT: the copy button is created via `createElement` inside the entry `<button>` — functional and keyboard-reachable, but technically invalid HTML nesting (a `<button>` inside a `<button>`). If that ever misbehaves, the fix is converting the entry to a div with `role="button"` + keydown handling.
- `src/style.css`: one small `.history-item-copy` rule (compact padding, no shrink) so the affordance sits cleanly in the row; no other layout changes.
