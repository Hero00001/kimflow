# 04 — Settings: localEngine + sherpaModel keys

Status: resolved
Blocked by: —

## Task

Add `localEngine` (`'whisper-cpp' | 'sherpa-onnx'`, default `'whisper-cpp'`) and `sherpaModel` (registry id string) to `DEFAULT_SETTINGS` and the `normalizeSettings()` whitelist in `backend/settings.cjs`; invalid values coerce to defaults. No one-time migration flag needed (absent key = whisper-cpp, today's behavior). No new secret keys.

## Acceptance

- Existing configs behave identically; invalid/unknown values never crash normalizeSettings.
- Settings round-trip through the UI persists both keys.

## Comments

- `backend/settings.cjs`: `localEngine: 'whisper-cpp'` and `sherpaModel: 'sense-voice-int8'` in DEFAULT_SETTINGS (commented: whisper.cpp IS today's behavior, absent key = no change; sherpaModel is a backend/model-download.cjs registry id) + whitelist coercion in `normalizeSettings()`:
  - `localEngine: ['whisper-cpp','sherpa-onnx']`, else default.
  - `sherpaModel: ['sense-voice-int8']` (the registry's sherpa-onnx entries; new model ids extend the list), else default.
- No migration flag, no new secrets. `src/electron.d.ts` Settings gained both keys.
- Renderer round-trip: `localEngine` is owned by the settings form (toggle group read from the UI via `ownedSettings()`, protecting it from stale broadcast snapshots); `sherpaModel` has no dedicated control (single registry entry — the model select shows it when the flavor is sherpa-onnx) and flows through the generic snapshot. `runPersist()` guards `whisperModel` so the SenseVoice select value can never leak into it.
- Tests: `test/local-engine-settings.test.cjs` — defaults, whitelist acceptance, 12-case localEngine coercion, sherpaModel coercion, and a cross-key isolation check (sherpa keys must not touch any other setting). Full suite 597/597 green.
