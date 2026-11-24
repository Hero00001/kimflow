# 13 — B4 remainder: saved-mic drift, full resume re-acquire

Status: ready-for-agent
Type: task
Batch: B4 (split)
Depends on: 05
Severity: MEDIUM

## Scope (split out of 05 — done parts are recorded there)

- **#10:** `populateMics` selects the stored device only when present, but the
  first enumerated device is kept and later re-saved — a permanently missing
  mic silently rewrites the saved preference (`src/audio/recorder.ts:57-81`,
  `src/settings-form.ts` runPersist copies `micSelect.value`).
  Fix direction: keep the stored value visible ("(unavailable)") instead of
  silently substituting the first device.
- **#13 full:** resume-after-device-change should RE-ACQUIRE the stream on the
  new device and append to the same recording, instead of the current
  fail-loud guard (`src/audio/recorder.ts` resumeCapture). Needs a design for
  concatenating two MediaRecorder segments (or per-segment WAV encoding with
  sample-level join in encodeWav).
- **#14 widget half:** the flow-bar widget shows no buttons in the
  `processing` state (`src/widget/widget.css:56-57`) — cancel stays
  unreachable from the widget during transcription. Belongs with B7's widget
  work.

## Acceptance

Fail-first tests for each; no silent substitution of the saved microphone;
resume captures the new device's audio appended to the same session; the
widget exposes cancel while transcribing.
