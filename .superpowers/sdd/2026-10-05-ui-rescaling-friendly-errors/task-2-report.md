# Task 2 Report — Local-whisper friendly top-line + empty-audio hint

Status: DONE. Commit `ce758ab` — "feat: friendly whisper errors and empty-audio hint" (3 files, +16/−5).

## What changed
- `test/local-whisper-errors.test.cjs` (new): verbatim plan test — missing-binary message must be
  friendly single-line (`/not found|Select Binary/i`, no `stderr|exit code`).
- `backend/engines/local-whisper.cjs`: catch block now builds `raw = parts.join('\n')`, maps
  `friendly = friendlyMessageFor(error) || 'Transcription failed — see details and try again.'`,
  throws `new Error(friendly)` with `.details = raw.slice(0, 2000)` and `.code` preserved.
- `backend/recorder.cjs`: empty transcript now throws `No speech detected — check mic level and
  try again.` with `.details = 'empty transcript (engine=...)'`; both abort/drop paths
  (`signal.aborted` branch and `shouldDropResult` branch) return `{ text: '', aborted: true }`.

## Test summary
- `test/local-whisper-errors.test.cjs` (verbatim): PASSED pre-change too — it hits the existing
  early `Whisper binary not found…` throw, not the catch path. Plan's expected FAIL did not
  reproduce via this path.
- FAIL reproduced on the real catch path instead (temp HOME + fake model + `node.exe` as fake
  binary, `signal: undefined`): pre-fix message was raw
  `whisper.cpp failed: Command failed… / stderr: … / exit code: 9` (`HAS_RAW: true`, no `.details`);
  post-fix message is `Transcription failed — see details and try again.` with raw kept in
  `.details` and `.code = 9` (`HAS_RAW: false`).
- `node --test test/local-whisper-errors.test.cjs test/friendly-errors.test.cjs`: 4 pass, 0 fail.
- Full `node --test test/*.test.cjs`: 33 pass, 0 fail (incl. `cancel.test.cjs`, untouched and green).

## Concerns for Task 3 / follow-ups
1. `src/recording.ts finishRecording()` does `if (result) { showTranscript(result.text); … }` — an
   `{ aborted: true }` object is truthy, so aborts now reach `showTranscript('')` until Task 3
   guards `result.aborted`. Same for `main.cjs` `if (result) sendToWindows(...)` forwarding.
   Task 3 must handle `{aborted:true}` silently.
2. Pre-existing quirk (out of scope, not changed): passing `signal: null` into `transcribe`
   throws `TypeError … instance of AbortSignal`, whose message contains "AbortSignal" and is
   misclassified as an abort by the `/abort/i` catch guard. Real callers pass `undefined` or a
   live signal, so production is unaffected — but the verbatim test's `null` signal would hit
   this if it ever reached the exec path.
3. Temp probe dirs under `%Temp%\opencode\fakehome` left on disk; safe to delete.

## Fix notes (2026-10-05 coverage gaps)
- `test/local-whisper-errors.test.cjs`: added catch-path regression test — fake HOME
  (`fs.mkdtempSync` + `.kimflow/ggml-small.bin`) with `process.execPath` (node.exe) as the
  executable fake binary (exits 9 on whisper args). Asserts message is the friendly
  single-line fallback (no `stderr:`/`exit code:`, no newline), `.details` holds raw
  (`whisper.cpp failed` + `exit code:`), `.code` preserved. Require-cache for
  `settings/model-download/local-whisper` is cleared + restored; env (`USERPROFILE`/`HOME`)
  restored; temp dir removed in `finally`.
- Same file: minimal recorder coverage — static shape assertions (empty-hint throw text +
  `empty transcript (engine=` details; >=2 `return { text: '', aborted: true }`) plus
  `shouldDropResult` runtime checks. No `stopRecording` integration (needs audio mocks);
  `cancel.test.cjs` untouched and green.
- Behavior kept: empty case throws the `No speech detected…` hint (not `{empty:true}`).
  Plan line 118 (`stopRecording` empty case returns `{ text:'', empty:true }`) is inconsistent
  with plan line 149 (throw hint) and with the shipped `recorder.cjs`; throw-hint is authoritative.
- Red-green: new catch test FAILS on reverted (raw-throw) `local-whisper.cjs`
  (`raw leaked into message … stderr: … exit code: 9`) and PASSES on the fix.
- Full `node --test test/*.test.cjs`: 35 pass, 0 fail (was 33; +2 new).
