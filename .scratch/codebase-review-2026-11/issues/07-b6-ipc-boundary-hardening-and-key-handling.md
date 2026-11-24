# 07 — B6: IPC boundary, Electron hardening and API-key handling

Status: done (B6 — A9 registry, d.ts split → B10; N6 → issues/15; N7 modes n/a on Windows)
Type: task
Blocked by: 01, 06
Batch: B6
Depends on: B0, B5
Severity: HIGH

## Implementation notes (2026-11-07)

- **#03 / W2 — fixed.** `hardenWindow()` attaches deny-all `will-navigate`
  and `setWindowOpenHandler` to the main window, the legacy overlay AND the
  widget (allow-list: our three file:// pages + the dev server origin).
  `isTrustedSender` additionally validates `event.sender.getURL()` — a
  webContents whose URL is not a KimFlow page is rejected even with a
  matching id, closing the navigate-to-escalate path.
- **#04 — fixed.** `check-whisper-binary` accepts only paths the MAIN process
  handed out (`knownBinaryPaths`: dialog results + managed engine installs,
  engine-managed paths re-seeded at startup). The arbitrary-path existence
  oracle is closed.
- **#05 — fixed.** All four Gemini call sites send the key in the
  `x-goog-api-key` header; it never appears in any URL, and the error-log
  redaction now logs the (secret-free) endpoint.
- **N3 — fixed.** CSP meta on `index.html` and `src/overlay.html`
  (`default-src 'none'; script-src 'self'; …`), mirroring widget.html.
  Verified by a real Electron 45 launch of the built page: readyState
  complete, ZERO console errors, zero CSP violations.
- **N4 — fixed.** `withTrustedBinaryPath()` blanks a renderer-supplied
  `whisperBinaryPath` that main never handed out before it reaches
  start/stop-recording → local-whisper's execFile candidate.
- **N5 — fixed.** `sandbox: true` on the main window and the legacy overlay
  (widget already had it); validated by the Electron 45 probe loading the
  production preload inside a sandboxed window.
- **N7 — fixed (sweep).** Startup sweep deletes `temp_recording_*.wav`
  leftovers (two real Aug orphans existed). POSIX `mode:` bits are a no-op on
  this Windows-only build — documented, not applied.
- **F-07 — fixed.** Explicit `nova-3` for a non-NOVA3 language downgrades to
  nova-2 exactly like `auto`.
- **F-08 — fixed.** `ensureHelper` is single-flight: concurrent callers share
  one spawn; shutdown clears the slot.
- **F-13 — fixed.** `resolveModel` mirrors `inspectModel`: 5xx/429/transport
  failures return the default WITHOUT caching; only successful discovery is
  cached.
- **F-17 — fixed.** Deepgram `testConnection` races a 15 s timeout (optional
  param for tests); the race loser can never become an unhandled rejection.
- **Deferred:** A9 typed IPC registry + `electron.d.ts` split → B10 (same
  files as the structural refactor). N6 model SHA-256 → issues/15 (needs the
  manifest repo to publish per-model hashes).
- **Fail-first proof:** `test/ipc-boundary-b6.test.cjs` — 10/10 fail against
  pre-B6 code, 10/10 pass after. Also caught by the pinned ordering test: the
  engine-path seeding initially ran BEFORE the secrets relocation (would have
  migrated plaintext keys to the legacy store) — reordered and commented.
- Gate: 532/532 tests, `tsc` clean, `test:isolated` PASS, real-launch CSP
  probe clean.
- **B6 follow-up (same day, contradiction rule):** re-examination found one
  real behavioral regression in the #04 fix — a dialog-selected binary did
  not survive restart, so start-recording would silently fall back to the
  managed engine. Fixed with a main-owned trust file
  (`userData/trusted-binaries.json`, renderer has no API to write it):
  dialog selections persist across restarts while config.json remains a
  non-trust source. Fail-first: fails without the fix, passes with (11/11).
  Also proved the #05 header mechanism LIVE against the real Gemini API:
  a garbage key yields `400 API_KEY_INVALID` — the header is read
  end-to-end. B6 is now verified to the standard of "no known gaps";
  inherent limits (multi-display click-through behaviour) remain tracked
  under B7's unverifiable-without-a-display list.

## Goal

Enforce the window privilege boundary and stop credentials / untrusted paths from reaching
native APIs. All three prior security tickets (#03/#04/#05) are STILL OPEN today.

## Findings covered

| ID | Defect | file:line |
|----|--------|-----------|
| #03 / W2 (HIGH) | `isTrustedSender` trusts `overlayWindow` (= the always-on-top widget) `webContents.id` for ALL 30 channels incl. `delete-secret`, `clear-history`, `save-settings`; no `will-navigate`, `setWindowOpenHandler`, or sender URL/frame check anywhere. Preload selects full/overlay/widget API by `pagePath()` regex, so navigating off `widget.html` re-grants `fullApi` | `main.cjs:246-256`, `preload.cjs:84-111` |
| #04 | `check-whisper-binary` runs `fs.statSync(binaryPath)` on any renderer string → arbitrary-path existence oracle | `main.cjs:516-525` |
| #05 (HIGH) | Gemini key sent as `params:{key}` in the URL query on every call; the console redaction `endpoint.replace(/=([^&=]+)$/, …)` is a no-op because axios appends the key | `gemini.cjs:60,232,282,297,340` |
| N3 | No CSP on main window / legacy overlay (widget has one) | `index.html:1-8`, `overlay.html:1-5` |
| N4 | Renderer-controlled `whisperBinaryPath` → first `execFile` candidate with no main-process provenance check → arbitrary native binary execution if a renderer is compromised | `settings.cjs:71`, `main.cjs:270`, `recorder.cjs:185`, `local-whisper.cjs:82-95` |
| N5 | Main + legacy overlay lack `sandbox:true` (widget has it) | `main.cjs:156-160`, `overlay-window.cjs:22-26` |
| N6 / F-16 | Model downloads have no SHA-256 and `total = Number(content-length)||0`; a chunked response with no header bypasses the byte gate and promotes a truncated `.bin` | `model-download.cjs:41-72,69-72` |
| N7 | Data at rest written with default perms (`0644`/`0755`); no crash-recovery sweep of `temp_recording_*.wav` — two real orphans from 2026-08-24 found | `settings.cjs:171-173`, `history.cjs:28-43`, `audio.cjs:104`, `recorder.cjs:162,303` |
| A9 / #20 / W8 | 40 bare-string IPC channels across 3 files with no registry/schema; `electron.d.ts:80-121` models ONE full API for all windows; `onMicLevel` undeclared; `toggle-recording` and `list-microphones` are dead | `main.cjs:246-596`, `preload.cjs`, `electron.d.ts` |
| F-07 | Explicit `nova-3` bypasses `NOVA3_LANGUAGES` downgrade | `deepgram.cjs:50-56` |
| F-08 | Concurrent `pasteViaHelper` spawns two helpers → double Ctrl+V + orphaned child | `paste-helper.cjs:166,228` |
| F-13 | `resolveModel` caches a failure-derived default forever (sibling `inspectModel` was fixed) | `gemini.cjs:224-250` |
| F-17 | Deepgram `testConnection` has no timeout (Speechmatics has 15 s) → button hangs disabled | `deepgram.cjs:166-179` |

## Affected files

`main.cjs`, `preload.cjs`, `index.html`, `src/overlay.html`, `src/electron.d.ts`,
`backend/gemini.cjs`, `backend/model-download.cjs`, `backend/settings.cjs`,
`backend/history.cjs`, `backend/audio.cjs`, `backend/paste-helper.cjs`,
`backend/engines/deepgram.cjs`.

## Fail-first tests

1. A renderer-initiated navigation on the widget window → assert denied and `fullApi` NOT granted.
2. `check-whisper-binary` with a path outside the allow-list → assert rejection.
3. Gemini request → assert the key is in `x-goog-api-key` header and NEVER in the URL.
4. Concurrent `pasteViaHelper` → assert exactly one Ctrl+V and one child process.
5. Model download with no `content-length` → assert rejection/hash mismatch, never promotion.

## Acceptance criteria

Deny-all `will-navigate` + `setWindowOpenHandler`; per-window API allow-lists bound to window
identity (not URL); sender URL/frame validation; path allow-list; header-based key + working
redaction; CSP on all three HTML entries; `sandbox:true` where compatible; SHA-256/known-size
gate on models; `mode:0o600`/`0o700` + startup WAV sweep; typed IPC schema; split `d.ts`.
