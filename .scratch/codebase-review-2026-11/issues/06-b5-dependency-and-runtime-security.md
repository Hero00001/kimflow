# 06 — B5: Dependency and runtime security (isolated, dedicated validation)

Status: done (B5)
Type: task
Blocked by: 01
Batch: B5
Depends on: B0
Severity: HIGH

## Implementation notes (2026-11-07)

- **N2 — fixed.** `axios` 1.19.0 → 1.21.0, `follow-redirects` 1.16.0 → 1.16.2
  (in-range updates). Both now audit CLEAN.
- **N1 — fixed.** `electron` ^33.0.0 → **45.2.3** (the audit's fix target).
  All ~40 Electron advisories cleared, including the contextIsolation bypass
  (GHSA-h7rp-cf8h-j98x) and permission-origin confusion (GHSA-9pf5-hg6p-4pwp).
- **Validation performed:** `npm test` 522/522, `npx tsc --noEmit` clean,
  `npm run build` (tsc+vite) clean, real Electron 45 launch smoke via
  `scripts/widget-shot.cjs` (window creation + loadFile + renderer execution +
  fresh screenshots), `npm run test:isolated` PASS.
- **Environment trap found during smoke:** this agent's shell sets
  `ELECTRON_RUN_AS_NODE=1`, which makes electron.exe run as plain Node and
  breaks `require('electron')`. NOT an Electron 45 defect — all Electron
  invocations here must unset it (`env -u ELECTRON_RUN_AS_NODE`).
- **Installer rebuild blocked by the PRE-EXISTING documented file lock:**
  `npm run pack` failed deleting the stale `dist-build/win-unpacked/resources/app.asar`
  (`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`) — the exact known Windows handle
  lock recorded in the project's build gotchas (Defender/Explorer/zombie
  app-builder; fix: reboot or close the holder). The Nov 1 installer in
  dist-build predates this batch. Not a 45 regression — packaging does not
  depend on the runtime version; rebuild the installer from a fresh session
  before the next release.
- **N8 — partially fixed.** `npm audit fix` applied all in-range dev fixes:
  audit went 33 → **18 advisories** (1 critical / 11 high / 4 moderate / 2 low),
  ALL remaining are dev-only (electron-builder 25 tree `tar` critical — its fix
  is the major 26.x, deferred; concurrently/shell-quote; vite tree). Zero
  advisories remain in shipped/runtime dependencies.
- **S1 — fixed.** Vendored dead code removed: `package/` (untracked extract of
  node-microphone 0.2.0, injection-prone spawn, referenced nowhere) and
  `node-microphone-0.2.0.tgz` (untracked, regenerable via `npm pack
  node-microphone@0.2.0`).
- **@deepgram/sdk** LOW advisory deliberately NOT taken (fix is semver-major
  3→5.18.0, per ticket instruction to evaluate separately).

## Goal

Remove shipped advisories. This batch must stay ISOLATED from logic fixes because the Electron
upgrade is a semver-major runtime change that can invalidate everything else.

## Findings covered (npm audit REPRODUCED: 33 total — 3 critical / 23 high / 5 moderate / 2 low)

- **N1 (HIGH):** installed `electron 33.4.11` is EOL with ~40 advisories including
  `GHSA-h7rp-cf8h-j98x` (contextIsolation bypass), `GHSA-9pf5-hg6p-4pwp` (permission-handler
  origin confusion), `GHSA-vmqv-hx8q-j7mg`, and window.open / sandbox-inheritance bypasses.
  These target the exact controls this app relies on. Audit fix: **45.2.3**,
  `isSemVerMajor: true`, affected range `<=42.11.15`.
- **N2 (HIGH):** runtime `axios 1.19.0` (12 GHSA) and `follow-redirects 1.16.0` (3 GHSA) —
  SSRF via redirect, prototype pollution, credential-header leakage on cross-origin redirect.
  Both `fixAvailable: true` within range. Every Gemini/Deepgram/Speechmatics API-key request
  goes through axios.
- **N8 (LOW, dev-only):** critical/high in `concurrently 9.2.4` (shell-quote), `vite 6.4.2`,
  electron-builder 25.1.8 tree (`tar` critical, `@xmldom/xmldom`, `node-gyp`). Not shipped,
  but a build/dev-machine supply-chain risk. Suggested electron-builder → 26.18.0.
- **S1 (LOW, SPECULATIVE):** vendored `package/index.js:5,217-231` has an injection-prone
  `spawn(command, audioOptions)` but there is NO `require('node-microphone')` anywhere in app
  code. Dead code; consider deleting `package/` and `node-microphone-0.2.0.tgz`.
- `@deepgram/sdk 3.13.0` has a LOW advisory whose fix is major (5.18.0) — evaluate separately,
  do not bundle with the Electron upgrade.

## Affected files

`package.json`, `package-lock.json`, and any code broken by the Electron major upgrade
(verify `preload.cjs`, `webPreferences`, `safeStorage`, `globalShortcut`, `session` APIs).

## Validation (this batch's "fail-first" equivalent)

1. Record the pre-upgrade `npm audit --json` summary and the full 483-test baseline.
2. Upgrade in a single commit; run `npm test`, `npx tsc --noEmit`, `npm run build`,
   `npm audit --json`.
3. Smoke-test a real Electron launch: window creation, `get-settings`, `safeStorage`
   decrypt of all three existing blobs, global hotkey registration, widget creation.
4. If any of those regress, revert the upgrade and record the blocker — do NOT paper over it.

## Acceptance criteria

Electron is on a supported major; axios/follow-redirects advisories cleared; shipped
dependency advisories reduced to zero (dev-only documented separately); `npm test` and
`tsc` still green; secrets still decrypt; no feature branch (commit directly to `main`).
