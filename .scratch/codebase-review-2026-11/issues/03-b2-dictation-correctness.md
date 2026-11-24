# 03 — B2: Dictation correctness — no wrong text, no late paste

Status: done (B2)
Type: task
Blocked by: 01
Batch: B2
Depends on: B0
Severity: CRITICAL

## Implementation notes (2026-11-07)

- **F-01 — fixed.** `doPaste` re-checks `shouldDropResult` before pasting; a
  cancel before `history.addSession` skips the entry; a cancel after AI polish
  returns `aborted`; a cancel after translation takes the history entry back
  via the new `history.removeSession` and returns `aborted`. The late HTTP
  request may still finish, but its result lands nowhere.
- **F-02 — fixed.** The redundant `cleanupText` in `recorder.cjs` is removed;
  the transcript is used as the engine delivered it (all three engines already
  clean with the user's polish mode). The empty-transcript guard remains.
- **F-06 — fixed.** A digit consumes the capitalisation opportunity:
  "2024 was a good year", "23 apples", "6 pm" — no more mid-clause capitals.
- **F-09 — fixed.** A punctuation-marked decimal digit ends the number:
  "three point one, four" → "3.1, 4" (was the wrong number "3.14").
- **F-10 — fixed.** Terminal `,` `;` `:` no longer get a full stop appended.
- **#01 — fixed.** The Speechmatics poll deadline now rejects with a timeout
  instead of fetching whatever the transcript endpoint returned, and a
  non-string body is rejected instead of JSON.stringify'd into the document.
- **#22 — fixed.** `finishRecording` no longer applies the invoke return; the
  `transcription-result` broadcast (which also feeds overlay/widget) is the
  single application point.
- **Contradictions resolved (deliberate test updates):**
  - `test/cleanup-modes.test.cjs` pinned `"6 Pm."` — that WAS the F-06 defect;
    expectation corrected to `"6 pm."`.
  - `test/recorder-session.test.cjs` / `test/transcription-emissions.test.cjs`
    fake engines returned raw text and relied on the removed recorder-level
    clean; stubs now return cleaned text per the real engine contract.
- **Fail-first proof:** `test/dictation-correctness-b2.test.cjs` — 8/8 fail
  against pre-B2 code, 8/8 pass after.
- Gate: 507/507 tests, `npx tsc --noEmit` clean, `npm run test:isolated` PASS.

## Goal

The defining promise of a dictation app: the RIGHT words land in the user's document, and a
cancelled dictation lands nowhere. Every finding here was REPRODUCED against current code.

## Findings covered

- **F-01 (CRITICAL, REPRODUCED):** `backend/recorder.cjs:205` checks `shouldDropResult` once,
  but `doPaste` runs later at `:243`/`:281` with no re-check. Cancel mid-translation ⇒
  `pasted=["TRANSLATED"]`, `aborted:undefined`; cancel mid-AI-polish ⇒ `["AI-POLISHED"]`.
  Text the user explicitly cancelled is injected into their active document AND history.
- **F-02 (HIGH, REPRODUCED):** all three engines already call `cleanupText`
  (`deepgram.cjs:163`, `speechmatics.cjs:138`, `local-whisper.cjs:125`) and `recorder.cjs:206`
  calls it AGAIN. `cleanupText(cleanupText("first, actually second, I mean third",'thorough'),'thorough')`
  → `"Third."` (single pass → `"Second, I mean third."`). Valid words deleted twice.
- **F-06 (HIGH, REPRODUCED):** `cleanup.cjs:26-35` uppercases the first *letter* not the first
  *character*: `"twenty three apples"` → `"23 Apples."`, `"2024 was a good year"` →
  `"2024 Was a good year."`. Deepgram `numerals:true` makes digit-leading transcripts common.
- **F-09 (MEDIUM, REPRODUCED):** `format-numbers.cjs:107-116` consumes punctuation-stripped
  decimal digits: `"the value is three point one, four"` → `"3.14"` (two numbers merged).
- **F-10 (MEDIUM, REPRODUCED):** `cleanup.cjs:38-41` appends `.` after terminal `:`/`;`
  → `"The items are:."`.
- **#01 (HIGH):** `speechmatics.cjs:89-111,130-132` poll deadline falls through without a
  `done`-reached check and `JSON.stringify`s a non-string body into the transcript.
- **#22:** `main.cjs:474-475` both broadcasts and returns the result; `src/recording.ts:65-70`
  and `:168-176` apply it twice.

## Affected files

`backend/recorder.cjs`, `backend/cleanup.cjs`, `backend/format-numbers.cjs`,
`backend/engines/speechmatics.cjs`, `backend/engines/deepgram.cjs`,
`backend/engines/local-whisper.cjs`, `main.cjs`, `src/recording.ts`, `test/cancel.test.cjs`.

## Fail-first tests (must fail against current code)

1. Orchestration-level cancel test (existing `test/cancel.test.cjs` only covers the pure
   `shouldDropResult` helper): cancel during a pending translation → assert `doPaste` never
   called and no `history.addSession`.
2. Idempotence: `cleanupText(cleanupText(x,'thorough'),'thorough') === cleanupText(x,'thorough')`.
3. Golden strings for `"twenty three apples"`, `"2024 was a good year"`,
   `"the value is three point one, four"`, `"the items are colon"`.
4. Speechmatics poll timeout → assert rejection, never a pasted JSON body.

## Acceptance criteria

Re-check `shouldDropResult` before EVERY `doPaste` and before `history.addSession`; pass the
AbortSignal to `translationService`. Remove the redundant `cleanupText` in `recorder.cjs`
(keep the empty-transcript guard). Fix capitalisation, decimal-run punctuation and terminal
punctuation. Eliminate the double result application.
