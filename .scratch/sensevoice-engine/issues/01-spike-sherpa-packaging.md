# 01 — Spike: verify sherpa-onnx Windows packaging for SenseVoice-Small

Status: resolved
Type: research
Blocked by: —

## Answer

(2026-11-24, verified against the k2-fsa/sherpa-onnx GitHub release API — primary source.)

- **Model asset** (`asr-models` release tag): `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2`, 155.5 MB, https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 — contains model.int8.onnx + tokens.txt. (Newer 2025-09-09 int8 re-export also exists at 158.1 MB; stick with 2024-07-17 for the widest sherpa-onnx version compatibility unless ticket 02 finds a reason to prefer it.) The fp32 variant is 999.3 MB — do not use.
- **Runtime asset** (latest release v2.0.3): `sherpa-onnx-v2.0.3-win-x64-shared-MT-Release-no-tts.tar.bz2`, 29.4 MB. Shared (exe + DLLs) vs static (239–248 MB compressed, self-contained exe): shared-MT is the right tradeoff. **MT = statically linked CRT, so no VC++ Redistributable prerequisite** — the biggest packaging risk from the spec is retired. `no-tts` drops text-to-speech weight we do not need.
- **VC++ runtime**: not required for MT builds (verify once on a clean path during ticket 06 by checking imports of the exe).
- **asar**: binary must live outside app.asar (app.asar.unpacked), same as the whisper sidecar pattern; execFile path resolution identical.
- **CLI shape**: `sherpa-onnx-offline --sense-voice-model=<dir>/model.int8.onnx --tokens=<dir>/tokens.txt <wav>` (verify exact flags against the v2.0.3 binary's `--help` during ticket 02; language/punctuation flags may differ).
- **Latency**: to be measured for real in ticket 06 on this Windows machine (download runtime + model to a temp dir, synthesize a speech wav via PowerShell System.Speech, run end-to-end). Download sizes (29 MB + 155 MB) make a genuine on-machine smoke test practical.
- **GO decision**: proceed with tickets 02–05 unchanged; no blocker found.

## Comments
