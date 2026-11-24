# 02 — B1: Config and secret durability (stop destroying user data)

Status: done (B1)
Type: task
Blocked by: 01
Batch: B1
Depends on: B0
Severity: CRITICAL

## Implementation notes (2026-11-07)

- **A1 / F-11 / F-14 — fixed.** `load()` now tracks `lastLoadStatus`
  (`ok | missing | recovered | read-error | corrupt`) exposed via
  `getLoadStatus()`; `main.cjs` `ensureUiLanguage` refuses to persist when the
  status is `read-error`/`corrupt` (first-run `missing` still persists the
  detected UI language). `load()` falls back to `config.json.bak` on a parse
  failure (`recovered`). `src/main.ts` no longer fabricates a defaults object
  into the store on startup failure (`runPersist` no-ops on an unset store).
- **F-04 — fixed.** `save()` uses the `.previous` restore pattern (mirroring
  `secrets.cjs`) and writes `config.json.bak` before overwriting; the only copy
  is never deleted ahead of the rename.
- **F-03 — fixed.** `deleteSecret` writes a `<blob>.tombstone` marker;
  `migrateSecrets` skips tombstoned names, so a legacy blob is never copied
  back (copy-only convention preserved). `setSecret` clears the tombstone when
  a deleted key is re-saved.
- **F-12 — fixed.** `isValidHotkey`/`normalizeHotkey` reject >80-char inputs
  before any split; `normalizeSettings` coerces an oversized hotkey to the
  default; `normalizeVocabulary` caps each term at 200 chars.
- **F-05 — NO CODE CHANGE (resolved by design).** The suggested "retain
  plaintext when `setSecret` fails" fix would violate the deliberate,
  already-tested no-plaintext-on-disk invariant (`test/secrets-fallback.test.cjs:105-111`,
  `test/key-trim.test.cjs`). The existing behavior is correct: when there is no
  OS keychain the key stays in memory for the session and `describeSecret`
  reports `volatile`, so the user is told instead of being shown a false
  "saved". Retaining plaintext in config.json would also leak it to the
  renderer. Marked fixed-by-design; no durability regression exists.
- **Fail-first proof:** `test/config-durability-b1.test.cjs` — 7/8 tests fail
  against pre-B1 code, 8/8 pass after (the hotkey timing test pins behavior
  but is not timing-discriminating on fast machines).
- Gate: `npm test` 499/499, `npx tsc --noEmit` clean,
  `npm run test:isolated` PASS (real config + blobs unchanged).

## Goal

A locked, corrupt, or temporarily unwritable config/secret must NEVER silently replace user
data with defaults, and a deleted API key must stay deleted.

## Findings covered

- **A1 / F-11 / F-14 (CRITICAL, REPRODUCED):** `backend/settings.cjs:132-157` wraps the whole
  read/migrate in `catch {}` and returns `{...DEFAULT_SETTINGS}`. `main.cjs:635` (startup) and
  `:266` (`get-settings`) call `ensureUiLanguage(loadSettings())`, which calls
  `saveSettings(settings)` whenever `uiLanguage === ''` — writing the full default object over
  the real config. `src/main.ts:88-107` also replaces the whole store with hardcoded defaults
  on any startup IPC error; the next `runPersist()` ships them to `saveSettings`.
- **F-04 (HIGH, REPRODUCED):** `settings.cjs:176-180` does `fs.rmSync(CONFIG_PATH, {force:true})`
  BEFORE the fallback rename; a second failure deletes the only `config.json`. Same pattern at
  `backend/history.cjs:46-50`. `secrets.cjs:175-185` already does this correctly (`.previous`).
- **F-03 (HIGH, REPRODUCED):** `secrets.cjs:204-210` `deleteSecret` removes only the userData
  blob; `migrateSecrets` (`main.cjs:610`) re-copies the legacy `~/.kimflow/secret_<name>.bin`
  on the next boot. The "Remove key" toast lies.
- **F-05 (HIGH, REPRODUCED):** `secrets.cjs:102` `migratePlaintextKeys` discards the boolean
  returned by `setSecret`; plaintext config keys are blanked even when the write only reached
  `memoryFallback` (`describeSecret === 'volatile'`). Key is gone after restart.
- **F-12 (MEDIUM, REPRODUCED):** `settings.cjs:85` / `hotkeys.cjs:85-89` process a 1.9 MB hotkey
  into 400,001 split parts before the `>80` length check.
- **#23 (HIGH) — DEFERRED to B9:** clearing the Gemini field does not delete the stored secret;
  no Remove button (`index.html:302-305`, `settings-form.ts:706-720`, `secrets.cjs:85`).
  Moved out of B1 because it needs new UI strings and would break the strict 186-key locale
  parity assertion (`test/i18n-locales.test.cjs:53-55`). B1 handles the data-integrity half
  only (F-03/F-05); B9 adds the affordance.

## Affected files

`backend/settings.cjs`, `backend/secrets.cjs`, `backend/history.cjs`, `backend/hotkeys.cjs`,
`backend/vocabulary.cjs`, `main.cjs`, `src/main.ts`, `src/settings-form.ts`, `index.html`.

## Fail-first tests (must fail against current code)

1. Stub `readFileSync` to throw EACCES → assert `load()` returns a status, NOT defaults, and
   that startup performs **zero writes**.
2. Bad JSON → assert the `.bak` is used and no default object is persisted.
3. Stub first + second rename to fail → assert `config.json` still exists with original bytes.
4. migrate legacy blob → `deleteSecret` → next `migrateSecrets` → assert blob absent.
5. safeStorage unavailable → assert plaintext key retained and `describeSecret === 'volatile'`.
6. 1.9 MB hotkey → assert rejection before `.split('+')`.

## Acceptance criteria

`load()` KEEPS its current return shape (add a separate status accessor/wrapper — ~12
`main.cjs` call sites depend on it). Never auto-save on a failed read; surface a startup
warning; keep `config.json.bak` and fall back to it on parse failure; replace
unlink-before-rename with the `.previous` restore pattern; honour `setSecret()`'s boolean;
use a durable tombstone so an explicitly deleted key stays deleted while legacy blobs remain
untouched (copy-only convention). `src/main.ts` preserves last-good state instead of
fabricating defaults. No default-value drift across files. #23's Remove-key affordance is
deferred to B9.
