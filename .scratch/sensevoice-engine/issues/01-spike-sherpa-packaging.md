# 01 — Spike: verify sherpa-onnx Windows packaging for SenseVoice-Small

Status: ready-for-human
Type: research
Blocked by: —

## Question

Can the sherpa-onnx Windows x64 prebuilt distribution run SenseVoice-Small as a standalone sidecar from an Electron-packed app? Verify: exact release asset URL + sha256 + extracted size; CLI invocation shape (`sherpa-onnx-offline` flags for SenseVoice); VC++ runtime dependency; behavior when bundled under `app.asar.unpacked`; cold-start and per-utterance latency on a typical Windows machine.

## Answer

(appended after the spike; outcome decides whether tickets 02–05 proceed unchanged)
