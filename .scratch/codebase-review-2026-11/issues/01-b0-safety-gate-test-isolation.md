# 01 — B0: Safety gate — tests must never touch real user data

Status: needs-triage
Type: task
Blocked by: none
Batch: B0
Depends on: none
Severity: CRITICAL

## Goal

Make the regression gate trustworthy BEFORE any production code changes. This batch is
non-negotiable: QA-01 means every later `npm test` can destroy the user's real API keys, and
QA-02 means 8 of 9 main-process tests currently exercise the wrong secrets path.

## Findings covered

QA-01 (CRITICAL, REPRODUCED) — `test/secrets.test.cjs:20-51` writes the real
`~/.kimflow/config.json` with a non-crash-safe backup/restore; `test/key-status.test.cjs:6-13`
and `test/key-trim.test.cjs:14-38` call `deleteSecret`/`setSecret` with no fake HOME.
QA-02 (HIGH) — `test/helpers/electron-main-harness.cjs:43,58`: `secrets.cjs` stub lacks
`describeSecret`/`SECRET_NAMES`/`setSecretsDir`/`migrateSecrets`; `engine-download.cjs` is `{}`.
`main.cjs:605-613` catches `setSecretsDir is not a function` and silently falls back to legacy
`~/.kimflow`, so `secret-state`, `has-secret`, `detect-gpu`, `download-engine` throw TypeError.
QA-05/06/07/08 = prior tickets #25–29 (override allow-list; DOM stub auto-creates unknown ids,
lacks `<select>`/option semantics, does not bubble).
QA-09 — three assertion-free tests in `test/paste-helper.test.cjs:204-216,218-231,278-281`.
QA-11/12/13 — conditional skips (`hotkeys.test.cjs:207,218,235`), permanent
`globalThis.Option` (`dom-stub.cjs:278`), timing sleeps, and the non-existent revert matrix
claimed at `spec.md:15-17`.

## Affected files

`test/secrets.test.cjs`, `test/key-status.test.cjs`, `test/key-trim.test.cjs`,
`test/helpers/electron-main-harness.cjs`, `test/helpers/dom-stub.cjs`,
`test/dom-stub.test.cjs`, `test/paste-helper.test.cjs`, `test/hotkeys.test.cjs`,
`package.json`, `scripts/` (new revert-matrix runner),
`.scratch/codebase-review-2026-10/spec.md` (correct 139 → 483, 23 → 29).

## Fail-first tests (must fail against current code)

1. A guard test asserting the real `~/.kimflow` and `userData` secret dirs are byte-unchanged
   after `npm test` (hash before/after).
2. Harness self-test invoking every registered IPC handler with no TypeError, plus an
   assertion that the `setSecretsDir` catch never fires.
3. `dom-stub.test.cjs`: undeclared id → `null`; `<select>` value/option sync; event bubbling.
4. Assertion-outcome tests for the three `paste-helper` cases.

## Acceptance criteria

- `npm test` is fully isolated (all FS tests use `mkdtempSync` + HOME/USERPROFILE restore).
- 483 existing tests still pass; `npx tsc --noEmit` clean.
- A real revert-matrix script exists and is wired into the gate.
- `git status` shows no real user config changed.

## Comments
