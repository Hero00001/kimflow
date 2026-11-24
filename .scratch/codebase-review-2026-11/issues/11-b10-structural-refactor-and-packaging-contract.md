# 11 — B10: Structural refactoring and packaging contract (DO LAST)

Status: partially done (B10) — contract pinned + dead surface removed; SessionStore / schema codegen / god-module splits deferred to issues/17
Type: task
Blocked by: 02, 03, 04, 05, 06, 07, 08, 09, 10
Batch: B10
Depends on: B1–B9
Severity: HIGH (risk), MEDIUM (user impact)

## Implementation notes (2026-11-07)

- **Step 1 — done.** `test/ipc-contract-b10.test.cjs` pins the ENTIRE IPC
  surface as an exact set (28 handled channels, 1 listener, 9 push channels
  across 4 main-process pusher files) and asserts bidirectional closure:
  no orphan invokes, no dead handlers, no orphan sends, no unsubscribed
  pushes. Fail-first proven: restoring the removed dead channels fails the
  exact-set pin.
- **A9 dead channels — removed.** `toggle-recording` and `list-microphones`
  had no renderer callers (the renderer enumerates devices itself; the
  widget drives recording via overlay-action). Removed from `main.cjs`,
  `preload.cjs`, `electron.d.ts`, and the preload-surface test's expected
  list. Harness integrity count 30 → 28.
- **Step 5 (partial) — done.** `test/ipc-contract-b10.test.cjs` also pins the
  packaging contract: `dist/src/overlay.html` must exist post-build and
  reference its BUNDLED asset, never the inert `/src/overlay.ts` entry (A7).
  `.github/workflows/ci.yml` reordered so the build precedes the test run.
- **Steps 2–4, 6 — DEFERRED to issues/17.** The typed schema codegen,
  SessionStore state-owner redesign, and the `main.cjs`/`settings-form.ts`
  splits are invasive refactors with zero user-facing gain. Doing them
  immediately before a release maximises regression risk against 543 green
  tests. The contract test added here pins the IPC surface, so the deferred
  refactor is now SAFE to do later — that was the point of step 1.
- **A10 remainder** (AI-polish) was already fixed in B3 (warnings[]);
  corrupt-blob→auth-error messaging remains tracked with issues/14.
- Gate: 548/548 tests (5 new contract tests), `tsc` clean, vite build clean,
  `test:isolated` PASS.

## Goal

Remove the systemic fragility once all behavioural bugs are pinned by tests. This batch is
LAST because `main.cjs`, `settings-form.ts`, `widget-window.cjs` and the IPC surface are
touched by nearly every earlier batch; restructuring first would multiply conflicts and
invalidate the fail-first tests.

## Findings covered

- **A6 (MEDIUM-HIGH):** five competing state holders, push-only sync with silent drops
  (`recorder.cjs:65-71`), no version/resync. `applySettingsToUi` replaces the store with a disk
  snapshot (`settings-form.ts:328-330`) while `runPersist` mutates that object in place
  (`:350-375`); `beginRecording` reads `microphone` from it (`recording.ts:24-36`).
  `src/main.ts:88-104` fabricates a SECOND full copy of `DEFAULT_SETTINGS` in the renderer.
  `useFlowBarWidget` has three readers (`main.cjs:195`, `audio/recorder.ts:179`, `main.cjs:583`).
- **A9 (MEDIUM):** ~40 channels are bare string literals across `main.cjs`, `preload.cjs`,
  `src/electron.d.ts` — no registry, schema or version. All 30 `ipcMain.handle` registrations
  sit inline in `main.cjs:258-596` (~50% of the 671-line file). The window boundary is a URL
  regex (`preload.cjs:111`), not a per-window allow-list. `toggle-recording` and
  `list-microphones` are dead channels.
- **A7 (MEDIUM):** packaged mode silently falls back to raw `src/overlay.html`
  (`main.cjs:121-135`), whose `/src/overlay.ts` tag (`overlay.html:109`) is inert over `file://`;
  `files:["src/**/*"]` (`package.json:48`) ships that inert page inside the asar. Both prod
  entry tests assert only `endsWith('overlay.html')` (`test/overlay-entry.test.cjs:74-86`),
  so a Vite output-path change ships a dead overlay with a green suite.
- **A8 (MEDIUM):** three window-load `.catch` sites only `console.error`; `overlay-action`
  always resolves by queueing, so the overlay's `.catch` is dead. Blank windows / ignored
  button presses look like "app works, nothing happened".
- **A10 (MEDIUM):** AI-polish failures swallowed (`recorder.cjs:226-228`); `polished` never
  rendered; a corrupt secret blob surfaces as a generic auth error.
- **God modules:** `main.cjs` (671), `src/settings-form.ts` (801, 36 functions),
  `backend/widget-window.cjs` (567), `src/style.css` (1035).
- **SPECULATIVE:** 16 ms poll CPU cost on multi-monitor/RDP; redundant IPC from
  `applySettingsToUi` + 500 ms debounced saves.

## Affected files

`main.cjs` → `backend/ipc/*.cjs`; `src/settings-form.ts` → form / persistence / engine-download
modules; `preload.cjs`, `src/electron.d.ts`, `src/store.ts`, `src/status.ts`, `vite.config.ts`,
`package.json` (`files` whitelist), `scripts/`. New: `backend/session-store.cjs`,
`backend/ipc-schema.cjs`.

## Ordered steps (each pinned BEFORE the change)

1. Channel-inventory test: enumerate all `ipcMain.handle`/`ipcMain.on` + every
   `ipcRenderer.invoke`/`send` + every push channel; assert 1:1 and no dead channels.
2. One typed schema generating handlers, bridges and `d.ts` with EXPLICIT per-window allow-lists.
3. `SessionStore` in main: `{recorderState, settingsVersion, recordingId}`, versioned snapshots,
   resync on subscribe and on window recovery; expire pending queues; remove in-place
   `getSettings()` mutation; `persist()` builds a fresh object from the DOM.
4. Split `main.cjs` and `settings-form.ts`; keep `widget-window.cjs` split last (it has the
   most runtime-specific geometry).
5. Packaging contract: remove the inert prod overlay fallback (fail loudly), propagate load
   promises, post-build test asserting `dist/src/overlay.html` exists and contains a BUNDLED
   asset (not a `/src/*.ts` tag), asar-contents test for the four `src/widget/*` files.
6. Central "degraded" status broadcast + visible error for all load/action failures.

## Acceptance criteria

One authoritative state owner; one IPC contract; no inert prod fallback; all god modules split
with no behaviour change; 483+ tests and `tsc` green; a clean-build smoke test proving the
packaged app renders both windows. Re-run the full revert matrix after the refactor.
