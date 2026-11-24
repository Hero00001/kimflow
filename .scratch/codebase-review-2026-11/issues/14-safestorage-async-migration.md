# 14 — Migrate safeStorage to the async APIs before Electron removes them

Status: ready-for-agent
Type: task
Batch: follow-up of B5
Depends on: 06
Severity: MEDIUM (deadline: before the Electron major that removes the sync API —
deprecation observed on 45.2.3: "will be removed. Please use 'safeStorage.isAsyncEncryptionAvailable' /
'encryptStringAsync' / 'decryptStringAsync' instead")

## Why

The Electron 45 runtime probe (`scripts/electron45-probe.cjs`) proved the
current synchronous safeStorage APIs still WORK on 45 —
encrypt/decrypt round-trip is byte-identical, so existing secret blobs are
safe. But Electron emits deprecation warnings and states the sync variants
will be REMOVED. `backend/secrets.cjs` uses them in `getSecret` (read) and
`setSecret` (write).

## Why this is not a quick fix (design sketch)

The sync APIs are load-bearing in synchronous settings paths:

- `migratePlaintextKeys(settings)` is called from `settings.cjs save()`,
  which is called synchronously from `load()`, which is called at startup
  and on every `get-settings`.
- Making `getSecret`/`setSecret` async cascades into `load()` → every
  `loadSettings()` call site in `main.cjs` (12 sites) → several IPC handlers
  become async → recorder.cjs engine paths.

Design direction:

1. Add async variants in secrets.cjs (`getSecretAsync`/`setSecretAsync`)
   using the new APIs; keep the sync ones as thin wrappers during migration.
2. Move the plaintext-migration off the synchronous `save()` path: do it
   once at startup (async, after `whenReady`), not inside every save —
   plaintext keys in config only existed for pre-secrets versions, so the
   per-save re-check is no longer needed (verify: `save()` calls
   `migratePlaintextKeys` defensively today).
3. Make `load()` async or split it: `loadSettingsSync()` (no secret access —
   secrets are never in config.json) and an async init that warms the secret
   store.
4. Fail-first tests: fake safeStorage exposing ONLY async APIs → assert
   secret round-trip still works; assert no sync-API call sites remain
   (static guard test like the innerHTML one).

## Acceptance

No Electron deprecation warning for safeStorage on launch; all secret
tests green against an async-only fake; existing blobs decrypt (round-trip
probe); `npm test` + probe green.
