# 04 — Settings: localEngine + sherpaModel keys

Status: ready-for-human
Blocked by: 03

## Task

Add `localEngine` (`'whisper-cpp' | 'sherpa-onnx'`, default `'whisper-cpp'`) and `sherpaModel` (registry id string) to `DEFAULT_SETTINGS` and the `normalizeSettings()` whitelist in `backend/settings.cjs`; invalid values coerce to defaults. No one-time migration flag needed (absent key = whisper-cpp, today's behavior). No new secret keys.

## Acceptance

- Existing configs behave identically; invalid/unknown values never crash normalizeSettings.
- Settings round-trip through the UI persists both keys.
