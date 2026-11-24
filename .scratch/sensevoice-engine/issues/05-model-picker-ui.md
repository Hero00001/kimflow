# 05 — Speech section UI: engine-aware model picker

Status: resolved
Blocked by: —

## Task

In the merged Speech section (ui-retheme ticket 03), make the model area engine-aware: when Local is chosen, a select offers whisper models (existing) and, when `localEngine` is `sherpa-onnx`, the SenseVoice registry entry with honest labels (languages + size). Reuse `#download-btn`, `checkModelStatus()`, and engine flavor button mechanics. A missing sidecar or undownloaded model selects whisper.cpp automatically and shows a status note explaining the fallback (per Hex's "omit rather than imitate": no fake SenseVoice row when the sidecar is absent).

## Acceptance

- Picker states: whisper-only (sidecar missing), sherpa available (model downloadable/downloaded), fallback active (visible note).
- English dictation with sherpa selected still transcribes via whisper with no user-visible error.

## Comments

- DESIGN CHOICE (minimal change): `settings.engine` toggle (local/speechmatics/deepgram) is UNTOUCHED — the SenseVoice option is a second flavor of Local, presented as a new "Local engine" toggle-group row (`#local-engine-row` / `#local-engine-group`, values `whisper-cpp` | `sherpa-onnx`) inside the merged Speech section, shown only when engine === 'local' AND on Windows (non-Windows keeps whisper.cpp; the resolver would fall back anyway, so the row is honestly absent rather than fake). Rationale vs making sherpa a third engine-group value: settings.engine's whitelist, dispatcher switch, and the deepgram/speechmatics UIs all key off engine values — a third value would have touched every one of them plus settings-schema semantics, while a flavor row reuses the existing toggle-group/ownedSettings machinery wholesale. The existing cpu/nvidia/amd flavor buttons pattern (refreshEngineButtons) is whisper-binary-specific and stays whisper-only.
- Model area is engine-aware: `#model-select` is repopulated from JS option sets — whisper tiny/base/small/medium (data-i18n carried, so renderStatic still re-translates on language change) vs the single registry entry `sense-voice-int8` labeled `SenseVoice-Small · zh/yue/ja/ko · 155 MB` (`settings.model.senseVoice`, same Latin label in all locales, mirroring how Nova/Tiny model names are untranslated product data). Whisper-specific rows (engine flavor download buttons, suggestion row, custom-binary advanced block) hide while sherpa-onnx is selected.
- `#download-btn`/`checkModelStatus()`/`wireDownload()`/progress mechanics reused verbatim: the existing `check-model-downloaded`/`download-model` IPC handlers route registry ids to the new registry flow (runtime archive auto-fetched before the model on first download, one progress bar, kind 'model'). No fake options: on non-Windows the flavor row is absent; when sherpa is selected the option IS downloadable, so it is always honest.
- Fallback visibility: new `#local-engine-status` (`model-status neutral`) driven by a new `sherpaStatus()` IPC (booleans only — no filesystem paths over IPC, B6 posture): shows `settings.localEngine.fallbackNote` ("SenseVoice is not ready — dictation falls back to Whisper.cpp.") when the sidecar or model is missing, the existing '✓ Ready' string when both are present, and the fallback note on status errors (never fakes readiness). Refreshed on flavor switch, on load, and on UI-language change.
- `runPersist()` guards `whisperModel` (never written from the SenseVoice select value); `localEngine` added to ownedSettings.
- i18n (en/ar/zh): `settings.localEngine.label/whisperCpp/sherpaOnnx/fallbackNote` + `settings.model.senseVoice`; key-count tests bumped 201 → 206; parity/placeholder tests green. New preload API `sherpaStatus` (main-window surface only; widget/overlay surfaces unchanged and still pinned by widget-preload-surface.test.cjs).
- Full suite 597/597 green; build green (dom.ts id gate covers local-engine-row/group/status).
