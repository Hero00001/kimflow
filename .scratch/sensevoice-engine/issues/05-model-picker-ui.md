# 05 — Speech section UI: engine-aware model picker

Status: ready-for-human
Blocked by: 02, 03, 04

## Task

In the merged Speech section (ui-retheme ticket 03), make the model area engine-aware: when Local is chosen, a select offers whisper models (existing) and, when `localEngine` is `sherpa-onnx`, the SenseVoice registry entry with honest labels (languages + size). Reuse `#download-btn`, `checkModelStatus()`, and engine flavor button mechanics. A missing sidecar or undownloaded model selects whisper.cpp automatically and shows a status note explaining the fallback (per Hex's "omit rather than imitate": no fake SenseVoice row when the sidecar is absent).

## Acceptance

- Picker states: whisper-only (sidecar missing), sherpa available (model downloadable/downloaded), fallback active (visible note).
- English dictation with sherpa selected still transcribes via whisper with no user-visible error.
