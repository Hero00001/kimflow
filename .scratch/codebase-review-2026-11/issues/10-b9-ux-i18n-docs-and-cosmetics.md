# 10 — B9: UX, i18n, documentation and cosmetics

Status: done (B9 — #07 deferred to issues/16 pending NATIVE ar/zh review)
Type: task
Blocked by: 01
Batch: B9
Depends on: B0
Severity: MEDIUM

## Implementation notes (2026-11-07)

- **#06 — fixed.** `renderStatic` no longer lies about runtime state: the
  `data-i18n` attribute was removed from the four runtime-owned elements
  (binary-path-display + the three key-status spans); JS owns their text from
  startup. Verified in a real launch: the attribute is gone, zero errors.
- **#23 — fixed.** The Gemini key field now has the same ✕ remove button as
  Deepgram/Speechmatics (reusing `settings.key.removeTitle`), wired to
  `deleteSecret('geminiApiKey')` + persist + status refresh, with a new
  `settings.key.geminiRemoved` toast in en/ar/zh (parity 188→189; the ONE new
  ar/zh string is machine-translated and flagged for native review).
- **#15 — fixed.** `normalizeHistoryData` now field-guards every entry
  (title/text strings, finite non-negative durationMs, finite createdAt) —
  malformed entries can no longer render `undefined` / `NaN sec` /
  `Invalid Date`.
- **#16 — fixed.** Failed engine downloads destroy the response and write
  streams BEFORE unlinking the temp zip (Windows unlink-while-open was the
  leak).
- **#17 — fixed.** Both progress payloads carry `kind: 'model' | 'engine'`;
  the renderer tracks the active download's kind and ignores mismatched
  progress. `DownloadProgress` type updated.
- **#08 — fixed.** `applyAccentColor` computes hover as accent lightened 12%
  instead of pinning both to the same colour; matches the stylesheet's
  default pair pattern.
- **#18 — fixed.** The legacy overlay is created `show:false` and shown after
  first paint — no more white flash (Linux now uses this path since B7/W1).
- **D1–D9, C6 — fixed in README** (keys location, pack output dir, icon file,
  platform claims, Deepgram model-resolution description, default hotkey
  `Ctrl+Shift+Space`, flow-bar description, Node 24 + `engines` field, npm
  test in validation, font-fallback note). The stale counts in
  `.scratch/codebase-review-2026-10/spec.md` were ALREADY annotated with
  corrections by the prior audit — editing a historical snapshot further was
  judged falsifying; left as-is.
- **#07 — DEFERRED to issues/16:** translating 30 language names into native
  ar/zh requires a native reviewer; machine translations would ship unreviewed
  UI text to ar/zh users. The mechanism is otherwise ready.
- **C2/C4 — deferred to B10** (structural).
- Gate: 543/543 tests, `tsc` clean, vite build clean, `test:isolated` PASS,
  real-launch probe: Gemini remove button present, `data-i18n` gone from the
  runtime-owned element, 0 console lines, 0 CSP violations.

## Goal

Make the product and the repo understandable, and stop shipping documentation that contradicts
the code. NOTE: the strict locale-key parity assertion (`test/i18n-locales.test.cjs:53-55`,
186 keys) means localisation work needs native ar/zh review — do not add keys casually.

## Findings covered

### Prior tickets (all STILL OPEN)

| # | Defect | file:line |
|---|--------|-----------|
| 06 (HIGH impact) | `renderStatic()` stamps `textContent` on every `[data-i18n]` including four runtime-owned elements (`binary-path-display`, three key-status rows); lies about key state | `i18n/index.ts:104-121`, `index.html:212,235,254,310` |
| 07 (HIGH for ar/zh users) | 30 language names hardcoded English, rendered via `new Option(option.label,…)` with no `t()` | `translation.ts:115-130`, `languages.cjs:3-33` |
| 15 | Malformed history entries render `undefined` / `NaN sec` / `Invalid Date` | `history.ts:52,63` |
| 16 | Failed engine download leaks a partial zip on Windows (stream still open at `unlinkSync`) | `engine-download.cjs:140-143` |
| 17 | Model + engine downloads share one `download-progress` channel with no discriminator | `model-download.cjs:53-59`, `engine-download.cjs:121-125` |
| 08 | `--accent-hover` equals `--accent`; every hover state invisible | `theme.ts:11-12`, `style.css:10-11` |
| 18 | Legacy overlay shown before first paint (flash) | `overlay-window.cjs:19` |
| 19 | **FIXED — no action** | `hotkeys.cjs:142-165` |
| 23 (HIGH, moved from B1) | Gemini key has no Remove affordance; clearing the field leaves the stored secret. Needs new UI strings + native ar/zh review to keep the 186-key locale parity assertion green. | `index.html:302-305`, `settings-form.ts:706-720`, `secrets.cjs:85` |

### Documentation drift (VERIFIED)

D1 README:135-137 says API keys live in `~/.kimflow/config.json` — FALSE; they are safeStorage
blobs in `app.getPath('userData')` (`main.cjs:606-610`, `secrets.cjs:43-45`).
D2 README:194-198 says `npm run pack` → `dist-electron/` — actually `dist-build/`
(`package.json:15-16`). D3 README:211 says `icon.png` — only `icon.ico` exists.
D4 README:25,48,206-209 claims macOS DMG / Linux AppImage releases — RELEASING.md:3,118-120
says Windows-only and the mac/linux icon targets are broken. D5 README:103 says only nova-3 and
`detect_language` unused — false (`deepgram.cjs:28-32`, `index.html:259-262`).
D6 no default hotkey documented (`settings.cjs:39` = `CmdOrCtrl+Shift+Space`).
D7 README:18,37,234,278-283 describes the legacy overlay, not the shipped flow-bar widget.
D8 README:41 says Node 18+, CI pins Node 24; no `engines` in `package.json`.
D9 stale key count 184 vs live 186; README:312-316 omits `npm test`.
Also correct `.scratch/codebase-review-2026-10/spec.md:7` (139 → 483) and `:311` (23 → 29).

### Comprehension

C2 `friendlyError` exact-match reverse index couples translation to backend English wording.
C3 `uiLanguage` / `inputLanguage` / `translationTarget` are conflated in README:116,125 —
these are THREE DISTINCT concepts (`settings.cjs:45,47,51`).
C4 `src/settings-form.ts` is 801 lines and owns DOM + persistence + downloads + i18n + key
status; tickets 09/10/23/24 all live there (structural split is B10).
C6 only 3 Latin woff2 ship; Arabic/CJK rely on OS fallback — undocumented.

## Affected files

`README.md`, `RELEASING.md`, `index.html`, `src/i18n/*`, `src/translation.ts`,
`src/history.ts`, `src/theme.ts`, `src/style.css`, `backend/languages.cjs`,
`backend/engine-download.cjs`, `backend/model-download.cjs`, `backend/overlay-window.cjs`,
`src/overlay.ts`, `package.json`, `.scratch/codebase-review-2026-10/spec.md`.

## Definition of done

All stale statements corrected; `renderStatic()` skips runtime-owned nodes; language dropdowns
use `t()` with native ar/zh review and the parity test still passes; history entries validated
on render; progress channel carries a discriminator; partial download cleanup fixed; hover
colour distinct; legacy flash fixed. `npm test` + locale parity + `tsc` green.
