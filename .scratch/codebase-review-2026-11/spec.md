# KimFlow Full-Spectrum Audit — Findings & Remediation Plan

Date: 2026-11-07 | HEAD: `a9fb21e` (v1.4.5, git clean) | Node v22.22.2
Scope: whole repository — main process, preload/IPC, backend, renderer, floating widget,
packaging, tests, dependencies, docs.
Method: `graphify-out/GRAPH_REPORT.md` for orientation only (STALE 2026-10-17 snapshot) →
seven parallel read-only investigations → cross-deduplication → lead verification of the
top findings against source → this register.

**Phase 1 was strictly read-only.** No source file was edited, created, deleted or committed.
Every `file:line` below refers to CURRENT code, not the 2026-10 tickets (whose line numbers
have drifted). Evidence labels: REPRODUCED (executed), CODE-TRACED (full call path read),
SPECULATIVE (explicitly separated).

---

## 0. Executive summary

The app is **green but not safe**: 483/483 tests pass and `tsc --noEmit` is clean, while
multiple reproduced CRITICAL defects are live. The October review fixed all P0/P1 findings
but left **29 P2 tickets untouched**; re-verification shows **27 are still open**. Seven
investigations then found roughly 70 candidate findings; after cross-deduplication
(`A4≡F-15`, `N6≡F-16`, `W9≡R1`, `W2≡#03`, `QA-05/06/07/08≡#25–29`, `C1⊂A3`, `A8≈W4`)
the register holds ~55 distinct issues.

Five things can disrupt the whole flow or destroy user data:

1. **Config wipe (A1 / F-11 / F-14, CRITICAL, REPRODUCED).** `backend/settings.cjs:132-157`
   catches *every* read/parse error and returns `DEFAULT_SETTINGS`. `main.cjs:635` and
   `main.cjs:266` then run `ensureUiLanguage(loadSettings())`, which calls
   `saveSettings()` whenever `uiLanguage === ''` — writing the full default object over the
   real config. One locked/corrupt `config.json` destroys engine, hotkey, microphone,
   languages and vocabulary with no error.
2. **Cancellation does not cancel (F-01, CRITICAL, REPRODUCED).** `backend/recorder.cjs:205`
   checks `shouldDropResult` once, but `doPaste` runs later at `:243`/`:281` with no re-check.
   Cancelling during translation or AI polish still injects the late result into the user's
   active document and writes history.
3. **Transcript cleaned twice (F-02, HIGH, REPRODUCED).** Every engine already calls
   `cleanupText` (`deepgram.cjs:163`, `speechmatics.cjs:138`, `local-whisper.cjs:125`) and
   `recorder.cjs:206` calls it again. In `thorough` mode the destructive self-correction
   rule fires twice: `"I want red, actually blue, I mean green"` → `"Green."`.
4. **`npm test` touches real user data (QA-01, CRITICAL, REPRODUCED).** `test/secrets.test.cjs:20-51`,
   `test/key-status.test.cjs:6-13`, `test/key-trim.test.cjs:14-38` write/delete the real
   `~/.kimflow/config.json` and secret blobs. Real config mtime changed to 14:03 during the
   audit. Content survived via a non-crash-safe backup/restore — **this time**.
5. **Shipped runtime is EOL (N1, HIGH, REPRODUCED).** Electron `33.4.11` carries ~40
   advisories including a contextIsolation bypass; fix is a major jump to `45.2.3`.

Also confirmed: **wrong text pasted** is the defining injury in this product (F-06 digit-leading
capitalisation → `"23 Apples."`; F-09 decimal merge → `"3.14"` from two numbers; F-10 `":."`),
yet no P2 ticket was rated above MEDIUM.

---

## 1. Verified baseline

| Check | Result |
|-------|--------|
| `npm test` (2 runs) | **483 pass / 0 fail / 0 skipped / 0 todo**; 72 files, 483 `test(` blocks; ~30–33 s |
| `npx tsc --noEmit` | exit 0 (12.3 s; only a `NODE_EXTRA_CA_CERTS` env warning) |
| `npm audit` | **33 advisories: 3 critical / 23 high / 5 moderate / 2 low** |
| Installed | electron 33.4.11, axios 1.19.0, follow-redirects 1.16.0, @deepgram/sdk 3.13.0, vite 6.4.2, electron-builder 25.1.8 |
| `~/.kimflow/config.json` | intact, 613 B, all non-default values preserved (`engine: deepgram`, `hotkey: F2`, `translationTarget: id`) |
| Secrets | all three blobs present in `AppData/Roaming/KimFlow`; copy-only legacy blobs in `~/.kimflow` |
| Orphan audio | two `temp_recording_*.wav` from 2026-08-24 still on disk (evidence for N7) |

**Stale documents — do not trust:** `spec.md:7` claims "139 passing" (that was commit
`079bade`, 51 commits before HEAD); `spec.md:311` says "23 files" (there are 29);
`spec.md:15-17` claims a revert-matrix script that does not exist in `package.json`;
`graphify-out/GRAPH_REPORT.md` is a 2026-10-17 snapshot predating the widget.

---

## 2. Prior backlog — current verdict (29 tickets)

**27 STILL OPEN · 1 FIXED (#19) · 1 CHANGED-SHAPE (#18) · 0 INVALID.**
The ~36 commits since October were P0/P1 fixes and feature work; they did **not** address the
P2 backlog. Only #19 was fixed incidentally by the `hotkeys.cjs` rewrite.

| # | Status | Current file:line | # | Status | Current file:line |
|---|--------|-------------------|---|--------|-------------------|
| 01 | OPEN | `speechmatics.cjs:89-111,130-132` | 16 | OPEN | `engine-download.cjs:140-143` |
| 02 | OPEN | `deepgram.cjs:133-136,163` | 17 | OPEN | `model-download.cjs:53-59`, `engine-download.cjs:121-125` |
| 03 | OPEN (HIGH) | `main.cjs:246-256`, `preload.cjs:111` | 18 | CHANGED | widget path fixed; legacy `overlay-window.cjs:19` only |
| 04 | OPEN | `main.cjs:516-525` | 19 | **FIXED** | `hotkeys.cjs:142-165` |
| 05 | OPEN (HIGH) | `gemini.cjs:60,232,282,297,340` | 20 | OPEN | `electron.d.ts:80-121`, `preload.cjs:57-63` |
| 06 | OPEN | `i18n/index.ts:104-121`, `index.html:212,235,254,310` | 21 | OPEN | `utils.ts:80` before `:85` |
| 07 | OPEN | `translation.ts:115-130`, `languages.cjs:3-33` | 22 | OPEN | `main.cjs:474-475`, `recording.ts:65-70,168-176` |
| 08 | OPEN | `theme.ts:11-12`, `style.css:10-11` | 23 | OPEN | `index.html:302-305`, `settings-form.ts:706-720` |
| 09 | OPEN (HIGH) | `settings-form.ts:346` (no `.catch`) | 24 | OPEN (HIGH) | `settings-form.ts:94-106`, `recording.ts:36` |
| 10 | OPEN | `settings-form.ts:352`, `audio/recorder.ts:74-77` | 25 | OPEN | `electron-main-harness.cjs:29-31` |
| 11 | OPEN (HIGH) | `recording.ts:149-151` | 26 | OPEN | `electron-main-harness.cjs:43,58` |
| 12 | OPEN | `audio/recorder.ts:242-256` | 27 | OPEN | `dom-stub.cjs:241-248,312-321` |
| 13 | OPEN (HIGH) | `audio/recorder.ts:207-211` | 28 | OPEN | `dom-stub.cjs:74,140-145,265` |
| 14 | OPEN (HIGH) | `status.ts:69,95`, `widget.css:56-57` | 29 | OPEN | `dom-stub.cjs:223-226,281-293` |
| 15 | OPEN | `history.ts:52,63` | | | |

**Severity mis-ratings (impact-based):** #03 and #05 are really HIGH (live credential exposure
and a fully trusted always-on-top renderer). #09, #11, #13, #14, #23, #24 and #01 are HIGH
from the user's perspective (silent data loss / false success / wrong text pasted).
Conversely #20 and #25–29 are `INTERNAL` — zero end-user impact — and should not compete
with the above for triage. The flat backlog (22 LOW, all `ready-for-agent`) inverts the harm
ordering.

**Regression of spec.md §4 (HIGH, new — R1):** the "all window refs nulled on `closed`"
invariant is broken. There are now **three** tracked refs. `main.cjs:227` is only
`overlayWindow.on('closed', () => { overlayWindow = null; })`; it never calls
`destroyWidgetWindow()`. `backend/widget-window.cjs:67` module-level `widgetWindow` is nulled
only via `destroyOverlayWindow()` (main-window close / `will-quit`). A standalone `closed`
leaves the ref, the 16 ms poll and three `screen` listeners dangling. Corroborated by W9.

Spec.md §4 claims that otherwise still hold: 30/30 `ipcMain.handle` call `assertTrustedSender`,
secret values never reach a renderer, no `innerHTML`/`eval` in `src/`, locale parity, WAV
header, zip-slip rejection, `encodeWav`.

---

## 3. New findings register (deduplicated)

### CRITICAL

| ID | Title | file:line | Evidence |
|----|-------|-----------|----------|
| A1 / F-11 / F-14 | Config read/corrupt failure → defaults re-persisted over real config | `settings.cjs:132-157`, `main.cjs:635`, `:266` | REPRODUCED (lead re-verified) |
| F-01 | Cancel during translation / AI polish still pastes late result into the document + history | `recorder.cjs:205,243,281,246` | REPRODUCED |
| QA-01 | `npm test` writes/deletes real user config and API keys | `test/secrets.test.cjs:20-51`, `key-status.test.cjs:6-13`, `key-trim.test.cjs:14-38` | REPRODUCED |

### HIGH

| ID | Title | file:line | Evidence |
|----|-------|-----------|----------|
| F-02 | Transcript cleaned twice; `thorough` deletes valid words twice | `recorder.cjs:206` + 3 engines | REPRODUCED |
| F-06 | Capitaliser uppercases first letter after a leading digit → `"23 Apples."` | `cleanup.cjs:26-35` | REPRODUCED |
| F-03 | Deleted API key resurrects next boot (legacy blob re-copied) | `secrets.cjs:204-210,71`, `main.cjs:610` | REPRODUCED |
| F-04 | `save()` `rmSync` deletes the only `config.json` before rename on EPERM | `settings.cjs:176-180`, `history.cjs:46-50` | REPRODUCED |
| F-05 | `setSecret` durable-write boolean discarded → plaintext erased when only volatile | `secrets.cjs:102,157-196` | REPRODUCED |
| A2 | Main renderer is a mandatory relay; `render-process-gone` → no reload, unbounded action replay | `main.cjs:230-237,174-188,557-569,34` | CODE-TRACED |
| A3 / C1 | No error envelope; `error.details` never survives IPC; `errorDetails` drops ≤180 chars | `utils.ts:7-12,52-59,79-95`, `main.cjs:306` | CODE-TRACED (lead re-verified) |
| A4 / F-15 | `/abort/i` classifier converts genuine provider failures into silent cancellation | `recorder-decisions.cjs:24-28`, `utils.ts:91`, `recorder.cjs:199` | REPRODUCED (lead re-verified) |
| A5 | `EACCES`/`ENOSPC` on the WAV path rendered as "Microphone blocked" | `recorder.cjs:162`, `audio.cjs:99-108`, `utils.ts:79-89` | REPRODUCED |
| N1 | Electron 33.4.11 EOL, ~40 advisories incl. contextIsolation bypass; fix 45.2.3 (major) | `package.json:12`, lock | REPRODUCED `npm audit` |
| N2 | axios 1.19.0 / follow-redirects 1.16.0 runtime advisories (SSRF, credential leakage) | lock; `gemini.cjs`, `speechmatics.cjs`, downloads | REPRODUCED `npm audit` |
| W1 | Linux skips `setIgnoreMouseEvents` → permanent always-on-top click blocker | `widget-window.cjs:332,349` | CODE-TRACED (lead re-verified) |
| R1 / W9 | Widget `closed` does not tear down subsystem → poll + 3 screen listeners leak | `main.cjs:227`, `widget-window.cjs:67,489,531-550` | CODE-TRACED (lead re-verified) |
| QA-02 | Harness stub gap makes startup silently fall back to legacy secrets path (8/9 tests) | `electron-main-harness.cjs:43,58`, `main.cjs:605-613` | REPRODUCED |
| QA-03 | `backend/transcribe.cjs` (engine dispatcher) is never executed by any test | `transcribe.cjs` (0 requires) | CODE-TRACED |
| QA-04 | `src/widget/widget.js` runtime never executed (static regex only) | `widget.js`, `widget-markup*.test.cjs` | CODE-TRACED |
| #03 / #05 / #09 / #11 / #13 / #14 / #23 / #24 | Prior tickets re-rated HIGH | see §2 | VERIFIED |

### MEDIUM

| ID | Title | file:line |
|----|-------|-----------|
| F-07 | Explicit `nova-3` bypasses `NOVA3_LANGUAGES` downgrade | `deepgram.cjs:50-56` |
| F-08 | Concurrent `pasteViaHelper` spawns two helpers → double Ctrl+V + orphan child | `paste-helper.cjs:166,228` |
| F-09 | Decimal number-word run merges two numbers / drops terminal punctuation | `format-numbers.cjs:107-116` |
| F-10 | Trailing `:` / `;` gets an extra `.` (`"The items are:."`) | `cleanup.cjs:38-41` |
| F-12 | Hostile 1.9 MB hotkey builds 400,001 split parts BEFORE the length cap | `settings.cjs:85`, `hotkeys.cjs:85-89` |
| F-13 | `resolveModel` caches a failure-derived default forever (sibling `inspectModel` was fixed) | `gemini.cjs:224-250` |
| A6 | Five competing state holders, no version/resync | `recorder.cjs:21`, `store.ts:1-9`, `settings-form.ts:328-330` |
| A7 | Packaged overlay entry silently falls back to inert `src/overlay.html`; tests assert only `endsWith` | `main.cjs:121-135`, `overlay.html:109` |
| A8 / W4 | Window-load and floating-UI action failures never surface to the user | `widget-window.cjs:512-525`, `main.cjs:201-207` |
| A9 | 40-channel ad-hoc IPC surface; per-window boundary is a URL regex; 2 dead channels | `main.cjs:246-596`, `preload.cjs:84-111` |
| A10 | AI-polish / unreadable-secret failures produce no user-visible signal | `recorder.cjs:213-229`, `secrets.cjs:109-133` |
| N3 | No CSP on main window and legacy overlay (widget has one) | `index.html:1-8`, `overlay.html:1-5` |
| N4 | Renderer-controlled `whisperBinaryPath` flows to `execFile` with no provenance check | `settings.cjs:71`, `local-whisper.cjs:82-95` |
| N5 | Main + legacy overlay lack `sandbox:true` | `main.cjs:156-160`, `overlay-window.cjs:22-26` |
| N6 / F-16 | Model downloads have no SHA-256; chunked response bypasses byte gate → truncated model promoted | `model-download.cjs:41-72`, `:69-72` |
| W2 | No `will-navigate` / `setWindowOpenHandler`; preload re-grants `fullApi` off widget path | `preload.cjs:84-111` |
| W3 | Hit-test ignores the 220 ms CSS size transition | `widget-window.cjs:393`, `widget.css:40` |
| QA-05..10 | Override allow-list, DOM stub fidelity, 3 assertion-free tests, untested renderer path | `test/helpers/*`, `paste-helper.test.cjs:204-231,278-281` |
| #01,#02,#06,#07,#12,#15,#17,#21,#22 | Prior tickets correctly MEDIUM | see §2 |
| D1–D9 / C2–C6 | 9 stale README/RELEASING statements + comprehension gaps | `README.md:18,24,25,37,41,103,116,125,135-137,194-198,206-211,234,278-283,312-316` |

### LOW / INTERNAL / SPECULATIVE

- N7 data-at-rest perms `0644/0755` + no WAV crash sweep (2 real orphan WAVs found) ·
  N8 dev-only critical advisories (`concurrently`, `tar`) · S1 vendored `node-microphone`
  injection-prone but dead · W5 16 ms poll never pauses on sleep/lock, sticky `cursorInside` ·
  W6 `reduce()`/`TABLE` dead code, "dev switcher" doc claim refuted · W7 rescue only when
  fully off-screen, "follows user across monitors" false · W8 `electron.d.ts` drift ·
  F-17 Deepgram `testConnection` has no timeout · F-14 startup defaults ·
  QA-11 conditional skips / permanent `globalThis.Option` · QA-12 timing sleeps ·
  QA-13 non-existent revert matrix · #08/#16/#18/#20/#25–29.
- **SPECULATIVE (not reproduced):** 16 ms poll CPU cost on multi-monitor/RDP; redundant IPC
  from `applySettingsToUi` + 500 ms debounce; in-memory keys in crash dumps; exact NTFS ACLs;
  reachability of Electron CVEs without an XSS primitive; S-1/S-2 environmental triggers.

---

## 4. Verified sound — do not re-audit

- 30/30 `ipcMain.handle` call `assertTrustedSender`; the single `ipcMain.on('mic-level')` uses
  non-throwing `isTrustedSender` + finite-number clamp + recording-state gate (`main.cjs:582-595`).
- `contextIsolation:true` + `nodeIntegration:false` on all three windows. Widget adds
  `sandbox:true` and `default-src 'none'; script-src 'self'` CSP.
- Secret values never reach a renderer (`settings.cjs:168-170` blanks all three keys;
  `load()` migrates plaintext); `safeStorage` blobs in `userData`; `secrets.cjs:175-185`
  EPERM path correctly uses `.previous` restore; `debugLog` gated by `KIMFLOW_DEBUG=1`.
- Engine downloads: pinned HTTPS + SHA-256 + byte gate + `safeEntryPath` traversal rejection
  + smoke test. Paste uses fixed `execFile` argv; dictated text only reaches `clipboard.writeText`.
- No `innerHTML`/`insertAdjacentHTML`/`eval` in `src/` (widget uses `textContent`).
- `encodeWav` header byte-correct; recorder `finally` restores READY; `awaitAbortable` settles
  both paths; `normalizeSettings` is prototype-pollution safe (REPRODUCED); `HEX_COLOR`
  rejects injection strings (REPRODUCED); no import cycles.
- Prior P0/P1 fixes verified still present: paste awaited, `cleanupText` honours `off`,
  hotkey conflict no longer aborts save, six owned settings read from DOM, `pack`/`dist`
  build first, dev overlay uses Vite, `history.clear()` removes `.bak`.
- **Widget screenshots exist.** `.scratch/flow-bar-widget/shots/` holds six gitignored PNGs
  dated 2026-11-01; the renderer DOES execute over `file://` and `widget-shot.cjs` WAS run.
  `.scratch/flow-bar-widget/audit.md` §6 ("look never observed / harness never run") is
  **REFUTED**. Drag, click-through and focus remain unobserved.

---

## 5. Impact-based severity framework

Map **user harm**, not code smell:

| Level | Rule |
|-------|------|
| CRITICAL | Wrong content written into the user's document, OR irreversible loss of data/credentials with no feedback |
| HIGH | One dictation lost, or the primary input path blocked, with inaccurate/no explanation |
| MEDIUM | Blocked but visible/recoverable, or persistent misinformation costing time |
| LOW | Cosmetic, resource, or latent |
| INTERNAL | Test harness, type surface, latent security — must NOT compete with user-facing fixes |

Modifiers: **+1 if silent** (user cannot self-rescue), **+1 if irreversible**, **+1 if it
affects every dictation/session**; any **trust lie** (app claims a key/history item is saved
or removed when it is not) is HIGH minimum.

---

## 6. Remediation roadmap (dependency-ordered)

Every batch is pinned by a test that **fails first** against current code. B0 blocks everything.
Batches B1–B9 are independent of each other except where noted; B10 is last because it
restructures the code the others touch.

| Batch | Goal | Findings covered | Depends on | Risk |
|-------|------|------------------|------------|------|
| **B0** | Safety gate: tests cannot touch real user data; harness tells the truth | QA-01, QA-02, QA-05–09, QA-11–13, #25–29 | none | LOW |
| **B1** | Config & secret durability | A1, F-11, F-14, F-03, F-04, F-05, F-12, #23 | B0 | MED |
| **B2** | Dictation correctness: no wrong text, no late paste | F-01, F-02, F-06, F-09, F-10, #01, #22 | B0 | MED |
| **B3** | Error reporting & failure classification | A3, A4≡F-15, A5, #21, A10 | B0 | MED |
| **B4** | Recording / mic / state control + renderer recovery | #09,#10,#11,#12,#13,#14,#24, A2, A6(partial) | B0, B3 | MED-HIGH |
| **B5** | Dependency & runtime security | N1, N2, N8, S1 | B0 | **HIGH** (Electron major) |
| **B6** | IPC boundary, hardening & key handling | #03,#04,#05, N3,N4,N5,N6≡F-16,N7, W2, A9(partial), #20/W8 | B0, B5 | MED-HIGH |
| **B7** | Floating widget subsystem | W1,W3,W4,W5,W6,W7,W9≡R1, #18, QA-04 | B0 | MED |
| **B8** | Coverage for the untested critical path | QA-03, QA-04, QA-10 | B0 | LOW |
| **B9** | UX, i18n, docs & cosmetics | #06,#07,#08,#15,#16,#17, D1–D9, C2–C6 | B0 | LOW |
| **B10** | Structural refactoring & packaging contract | A6, A7, A8, A9, A10, god-module split | B1–B9 | **HIGH** |

Dependency graph: `B0 → {B1..B9} → B10`, with `B3 → B4`, `B5 → B6`.
One file per ticket lives in `issues/01-*.md` … `issues/11-*.md` (B0…B10).

### Why this order

- **B0 first** is non-negotiable: QA-01 means every subsequent test run risks the user's real
  keys, and QA-02 means main-process tests currently validate the wrong secrets path.
- **B1 before B2/B4** because a config wipe or resurrected key invalidates any behavioural test.
- **B5 isolated** because Electron 33 → 45 is a semver-major runtime change; it needs its own
  build + smoke + `npm audit` pass and must not be mixed with logic fixes.
- **B10 last** because `main.cjs` (671), `settings-form.ts` (801), `widget-window.cjs` (567)
  and the 40-channel IPC surface are touched by nearly every earlier batch. Splitting them
  first would multiply merge conflicts and invalidate the fail-first tests.

---

## 7. Definition of done

For each batch: (1) fail-first test committed with the batch, (2) `npm test` 483+ passing,
(3) `npx tsc --noEmit` clean, (4) `npm audit` re-run where dependencies changed,
(5) `git status` shows only intended files, (6) commit directly to `main` (project convention;
no feature branches / PRs), (7) a QA pass that *independently reproduces* the original defect
and confirms it is gone — not merely that tests are green.

Gate script to add in B0: `npm test && npx tsc --noEmit` plus a real revert-matrix script
(each new test must fail against pre-change production code).

---

## 8. Cannot be proven statically

1. Widget hover/leave + click-through toggle, drag and the three buttons — needs an on-screen run.
2. DPI / mixed-monitor / negative origin / resolution change, display sleep/lock.
3. Focus stealing, `alwaysOnTop` over fullscreen apps, transparency/first-paint flash.
4. Linux/Wayland behaviour (W1) — run the AppImage.
5. Packaged asar contents — assert the four `src/widget/*` files are inside the built asar.
6. `will-navigate` → `fullApi` escalation — needs a real renderer navigation attempt.
7. Whether Electron 33 CVEs are reachable without an XSS primitive (none found statically).
8. S-1/S-2 environmental triggers (real AV-locked file, real Linux keyring, CDN without
   `content-length`).

---

## 9. Source reports

Findings retain their origin IDs: `A*` architecture, `F*` code-level bug hunt,
`N*` security, `W*` widget, `QA*` test integrity, `R1` regression, `C*`/`D*`
comprehension/docs, `#NN` prior tickets. Full reports were delivered to the team lead;
this file is the consolidated, deduplicated register.
