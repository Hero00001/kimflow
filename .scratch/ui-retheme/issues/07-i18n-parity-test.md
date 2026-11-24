# 07 — Translation-parity i18n test

Status: resolved
Blocked by: —

## Task

New `test/i18n-parity.test.cjs` (node --test): import the bundles from `src/i18n`, assert every key present in `en` exists in `ar` and `zh` (and vice versa), with a readable failure message listing missing keys. Mirrors Hex's test-enforced translation parity.

## Acceptance

- Test passes on current strings; deliberately deleting a key makes it fail.
- Wired into `npm test`.

## Comments

- Added `test/i18n-parity.test.cjs` (node --test, auto-picked-up by the existing `node --test test/*.test.cjs` glob — no package.json change needed). Uses the existing `test/helpers/ts-loader.cjs` to transpile the TS locale bundles in-memory.
- Three assertions, each listing every offending key in the failure message: (1) every en key exists in ar and zh, (2) no locale defines keys beyond en, (3) no empty/non-string values.
- Overlaps intentionally with the deepEqual-based parity check in `i18n-locales.test.cjs`; the new test is the readable-failure variant the ticket asks for.
- Verified green with the full suite (578 tests pass). Deleting a key from a locale fails with `ar: history.clear, ...` style output.

### Fix (2026-11-24)

- The "every locale value is a non-empty string" assertion iterated only ar/zh — an empty en value would pass. EN is now included in that loop.
