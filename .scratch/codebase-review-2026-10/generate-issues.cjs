// Generates the deferred-findings issue files for the codebase review.
// Run: node .scratch/codebase-review-2026-10/generate-issues.cjs
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'issues');

const ISSUES = [
  {
    slug: 'speechmatics-poll-and-transcript-body',
    title: 'Speechmatics fetches a transcript before the job is done, and can paste a JSON body as text',
    severity: 'MEDIUM',
    where: '`backend/engines/speechmatics.cjs:74-118`',
    context:
      'The poll loop runs until its 120 s deadline and exits **without checking that the job actually reached `done`** — the loop only breaks on `status === \'done\'`, so a timeout falls through to the transcript fetch anyway.\n\n'
      + 'The transcript response is then accepted on any 2xx, and when the body is not a string it is `JSON.stringify`d and returned as the transcript.',
    failure:
      'A long recording whose job has not finished yields either an error body or a JSON object, and that JSON is pasted into the user\'s focused application as if it were the dictation.',
    fix:
      'Track whether the job reached `done`; after the loop, throw a clear timeout error if it did not. Reject a non-string transcript body instead of stringifying it.',
    test: 'A `speechmatics` transcribe test with a stubbed axios that never reports `done`, and one whose transcript endpoint returns an object.',
  },
  {
    slug: 'deepgram-detected-language-unvalidated',
    title: 'Deepgram\'s detected language reaches the translation prompt unvalidated',
    severity: 'LOW',
    where: '`backend/engines/deepgram.cjs:86-89`',
    context:
      '`detectedLanguage` is taken from `alternative.languages?.[0]` and passed on as the translation source language (`backend/recorder.cjs`, `backend/gemini.cjs` `buildPrompt`). It is never checked against `backend/languages.cjs` `isKnownLanguage`, so a code the app does not know is interpolated into the prompt verbatim.',
    failure:
      'The Gemini prompt says "Translate the text below the language \\"X\\"" with an X the app never validated, which reads as a malformed instruction and can degrade the translation.',
    fix:
      'Validate the detected language with `isKnownLanguage` and fall back to `null` (meaning "its original language") when it is unknown.',
    test: 'A `deepgram` transcribe test whose response reports an unknown language code.',
  },
  {
    slug: 'overlay-trusted-for-all-ipc',
    title: 'The overlay window is trusted for every IPC channel, and nothing blocks navigation',
    severity: 'LOW',
    where: '`main.cjs:181-187` (`assertTrustedSender`), `preload.cjs:54-70`',
    context:
      '`assertTrustedSender` grants the overlay the same privileges as the main window for **all** channels. The preload limits the overlay to a smaller API only by checking the page URL, and there is no `will-navigate` or `setWindowOpenHandler` guard anywhere in the app.',
    failure:
      'If the overlay is ever navigated away from `overlay.html` — a redirect, a link with `target="_blank"`, a dev-server URL — the new document receives the full API from the preload and its `webContents.id` still passes `assertTrustedSender`, so it inherits main-window privileges including secret deletion and history access.',
    fix:
      'Restrict the mutating channels to the main window, and add `will-navigate` / `setWindowOpenHandler` guards to both windows.',
    test: 'A main-process test that calls a mutating handler with the overlay as the sender and expects it to be rejected.',
  },
  {
    slug: 'check-whisper-binary-path-oracle',
    title: 'check-whisper-binary is an arbitrary-path existence oracle',
    severity: 'LOW',
    where: '`main.cjs:422-431`',
    context: 'The handler `statSync`s any string the renderer supplies and returns `isFile()`, answering "does this path exist and is it a file" for any path on disk.',
    failure:
      'Any script-injection or XSS in the renderer — or a compromised overlay (see the previous issue) — can enumerate the filesystem one path at a time through a channel that looks like a harmless binary check.',
    fix:
      'Restrict the check to paths the app itself selected, or drop the channel and validate the binary in the main process at the point of use.',
    test: 'A main-process test asserting the handler rejects a path it did not hand out.',
  },
  {
    slug: 'gemini-api-key-in-url',
    title: 'The Gemini API key travels in the URL query string, and the log redaction is a no-op',
    severity: 'LOW',
    where: '`backend/gemini.cjs:59-64`, `:210-215`, `:260-265`, `:318-323`, `:273-278`',
    context:
      'Every request passes the key as `params: { key }`, so it lands in the request URL. The console redaction is `endpoint.replace(/=([^&=]+)$/, \'=[REDACTED]\')`, but `endpoint` never contains the key — axios appends it from `params` — so the redaction protects nothing.',
    failure:
      'Any proxy, corporate gateway or server access log between the app and Google captures the full API key in the request URL, and the app\'s own attempt to keep it out of the logs does not work.',
    fix: 'Send the key in the `x-goog-api-key` header instead of the query string, and redact the request URL as it is actually sent.',
    test: 'A gemini test asserting the key never appears in the request URL.',
  },
  {
    slug: 'render-static-clobbers-runtime-values',
    title: 'renderStatic() overwrites values that are set at runtime',
    severity: 'MEDIUM',
    where: '`src/i18n/index.ts:104-121`, `index.html:212`, `:235`, `:254`, `:310`',
    context:
      '`renderStatic()` stamps `t(key)` onto every element carrying `data-i18n`. Four of those elements also carry their text at runtime: `#binary-path-display` and the three `#*-key-status` rows.',
    failure:
      'Switching the UI language resets the binary row to "Not selected" and the key rows to "No key saved", discarding the live values. The settings form repairs them asynchronously, so the wrong values stand whenever that repair does not run.',
    fix:
      'Give the runtime-owned elements their own marker so `renderStatic` skips them, and let the settings form own their text entirely.',
    test: 'A `renderStatic` test asserting a runtime-owned element keeps its text.',
  },
  {
    slug: 'language-dropdowns-not-localised',
    title: 'The Input Language and Translate To dropdowns are never localised',
    severity: 'MEDIUM',
    where: '`src/translation.ts:112-127`, `backend/languages.cjs:3-33`',
    context:
      '`populateLanguages()` builds the options from the `label` the backend returns, and `backend/languages.cjs` hardcodes English names. The dropdowns carry no `data-i18n` and never pass through `t()`.',
    failure:
      'In the Arabic and Chinese interfaces — the two the app was just translated into — the language lists still read "Auto Detect", "English", "Chinese (Mandarin)".',
    fix:
      'Return language codes from the backend and map them to localised labels in the renderer. This needs 30 names per locale, so the Arabic and Chinese wording needs native review rather than a mechanical copy.',
    test: 'A locale-parity test covering the `languages.*` keys, once they exist.',
  },
  {
    slug: 'accent-hover-same-as-accent',
    title: 'The accent hover colour is the accent colour, so no hover state is visible',
    severity: 'LOW',
    where: '`src/theme.ts:12` vs `src/style.css:11`',
    context:
      '`applyAccentColor()` sets `--accent-hover` to the accent colour itself, while the stylesheet default is a lighter shade (`#9d6ff7` against `#8b5cf6`).',
    failure: 'Choosing any custom accent colour makes every `.btn-primary:hover` and `.ctrl-btn.primary:hover` render identically to its resting state, so the hover affordance disappears app-wide.',
    fix: 'Derive a lighter hover shade from the accent colour, the way the stylesheet default does.',
    test: 'A theme test asserting `--accent-hover` differs from `--accent`.',
  },
  {
    slug: 'persist-chain-rejection-kills-persistence',
    title: 'One rejected persist permanently stops settings persistence',
    severity: 'LOW',
    where: '`src/settings-form.ts:217`',
    context:
      '`persistChain = persistChain.then(runPersist)` has no rejection handler, so a single rejection turns the chain into a rejected promise and every later `persistChain.then(runPersist)` short-circuits.',
    failure:
      'Any change that makes `runPersist()` throw permanently freezes settings persistence for the rest of the session, with no visible error.',
    fix: 'Add a `.catch` so one failure cannot poison the chain.',
    test: 'A settings-form test that rejects one save and checks the next one still reaches the backend.',
  },
  {
    slug: 'microphone-selection-overwritten',
    title: 'The saved microphone is overwritten by whatever is first in the device list',
    severity: 'LOW',
    where: '`src/settings-form.ts:223`, `src/audio/recorder.ts:70-76`',
    context:
      '`runPersist()` copies `micSelect.value` into the settings unconditionally. `populateMics()` only assigns the select value when the stored device is still present, so the select otherwise keeps the first enumerated device.',
    failure:
      'The user\'s USB microphone is unplugged and the app restarted; the next unrelated settings save silently rewrites the microphone preference to the built-in device, which the user never chose.',
    fix: 'Only write the microphone when the user changed the selection.',
    test: 'A settings-form test where the stored device is absent from the list.',
  },
  {
    slug: 'pointerleave-stops-unrelated-recording',
    title: 'Moving the pointer across the record button stops a recording it never started',
    severity: 'MEDIUM',
    where: '`src/recording.ts:149-151`, `:114-131`',
    context:
      'In push-to-talk mode the `pointerleave` handler calls `handleTrigger(false)`, which calls `finishRecording()` — but nothing checks that this button started the session.',
    failure:
      'The user starts dictating with the global hotkey and the pointer merely travels across the record button: `pointerleave` fires and the dictation is cut off mid-sentence.',
    fix: 'Track whether this button owns the session and only release a session it started.',
    test: 'A recording test that dispatches `pointerleave` while a hotkey-started session is live.',
  },
  {
    slug: 'devicechange-pauses-on-any-change',
    title: 'Any device-list change pauses an active recording',
    severity: 'MEDIUM',
    where: '`src/audio/recorder.ts:209-223`',
    context:
      'The `devicechange` handler cannot distinguish "my microphone was unplugged" from "some other device appeared", and pauses whenever the capture is recording.',
    failure:
      'Plugging in a USB headset, a webcam or a Bluetooth speaker mid-dictation pauses the recording for no reason.',
    fix: 'Compare the device list before and after, and pause only when the active device actually disappeared.',
    test: 'A recorder test that fires `devicechange` with an added (not removed) device.',
  },
  {
    slug: 'resume-after-mic-change-records-silence',
    title: 'Resuming after a microphone change records silence',
    severity: 'MEDIUM',
    where: '`src/audio/recorder.ts:174-178`, `src/recording.ts:182-183`',
    context:
      '`resumeCapture()` calls `mediaRecorder.resume()` on the same recorder and stream that were bound to the unplugged device. Nothing re-runs `getUserMedia`. The comment in `recording.ts` promises "the user can resume on another device", but the implementation does not do that.',
    failure:
      'After a device unplug the app shows "Paused"; the user resumes and speaks into another microphone, but the recorder\'s source track has ended — the second half of the dictation is silently dropped.',
    fix: 'Re-acquire the stream on resume when the track has ended, and start a new recorder that appends to the same chunk buffer.',
    test: 'A recorder test that ends the track, resumes, and asserts the new stream is used.',
  },
  {
    slug: 'transcription-cannot-be-cancelled',
    title: 'A transcription cannot be cancelled from any UI',
    severity: 'MEDIUM',
    where: '`src/status.ts:69`, `:95`, `src/overlay.ts:36`, `src/recording.ts:209-224`',
    context:
      'During `TRANSCRIBING` the main window disables its cancel button, the overlay disables **all** of its buttons including cancel, and the Escape handler only fires for `RECORDING`/`PAUSED`. The backend has a working abort path (`backend/recorder.cjs`, `cancelRecording` -> abort -> `{aborted:true}`).',
    failure:
      'A long local-Whisper transcription cannot be interrupted — the user is locked out of every control until it finishes, even though the backend could abort it.',
    fix: 'Keep the cancel control enabled while transcribing and route it to `cancelRecording`.',
    test: 'A status test asserting the cancel control stays enabled while transcribing.',
  },
  {
    slug: 'malformed-history-entries-render-undefined',
    title: 'Malformed history entries render as "undefined", "NaN sec" and "Invalid Date"',
    severity: 'LOW',
    where: '`src/history.ts:52`, `:63`, `:10-18`, `:20-27`',
    context:
      'The search filter tolerates malformed entries (`session?.title || \'\'`), but the render loop dereferences `entry.title`, `entry.createdAt` and `entry.durationMs` unguarded. `formatDuration(undefined)` is `Math.max(1, NaN)` -> `NaN`, and `formatRelativeTime(undefined)` is `new Date(undefined)`.',
    failure: 'One corrupt or older-format entry renders a history row titled "undefined" with "Invalid Date • NaN sec".',
    fix: 'Skip entries without a usable title, and guard the duration and date formatting.',
    test: 'A history test that renders a malformed entry.',
  },
  {
    slug: 'engine-download-partial-file-leak',
    title: 'A failed engine download leaves a partial zip behind on Windows',
    severity: 'LOW',
    where: '`backend/engine-download.cjs:129-132`',
    context:
      'On a mid-stream network error the response stream is still open when the catch block calls `fs.unlinkSync(tempDest)`. On Windows an open file cannot be deleted, and the error is swallowed — so a partial zip (up to 273 MB) stays in `~/.kimflow/engines/` forever, and every retry adds another uuid-named leftover.',
    failure: 'Repeated failed downloads fill the config directory with orphaned partial zips.',
    fix: 'Destroy the response stream and wait for the writer to close before unlinking.',
    test: 'An engine-download test that fails mid-stream and asserts no zip is left behind.',
  },
  {
    slug: 'shared-download-progress-channel',
    title: 'Model and engine downloads share one progress channel with no discriminator',
    severity: 'LOW',
    where: '`backend/model-download.cjs:53-59`, `backend/engine-download.cjs:108-114`',
    context:
      'Both emit `download-progress` with an identical `{downloaded,total,percent}` payload, and `main.cjs` has no mutual exclusion between the `download-model` and `download-engine` handlers.',
    failure: 'Starting both at once shows the percentage of one item under the other\'s label.',
    fix: 'Add a discriminator to the payload (a kind or id), and have the renderer route on it.',
    test: 'A settings-form test that interleaves two progress events.',
  },
  {
    slug: 'overlay-transparent-window-flash',
    title: 'The overlay is shown before its first paint',
    severity: 'LOW',
    where: '`backend/overlay-window.cjs:19`, `main.cjs:152-161`',
    context: 'A transparent, frameless window is displayed immediately at construction; on Windows the compositor has not painted the page yet.',
    failure: 'Every app start shows a brief opaque square at the top of the screen before the pill appears.',
    fix: 'Create the window with `show: false` and show it on `ready-to-show`.',
    test: 'An overlay-window test asserting the window is not shown at construction.',
  },
  {
    slug: 'hotkey-restore-claims-success',
    title: 'The hotkey restore path claims success even when the restore failed',
    severity: 'LOW',
    where: '`backend/hotkeys.cjs:51-67`',
    context:
      'When a new hotkey cannot be registered, the previous one is re-registered but its result is ignored, and `activeHotkey` is set to the previous value regardless.',
    failure:
      'If the old hotkey has since been taken by another application, the app believes it still owns a hotkey while none is registered — the user has no hotkey and no error message.',
    fix: 'Check the result of the restore and report the failure.',
    test: 'A hotkeys test where both the new and the restored registration fail.',
  },
  {
    slug: 'electron-dts-does-not-model-overlay-api',
    title: 'electron.d.ts models one full API for both windows',
    severity: 'LOW',
    where: 'src/electron.d.ts:79-119` vs `preload.cjs:54-60`',
    context:
      'The `Window` interface declares the full API for every window, but the preload exposes only `overlayAction`, `getRecordingState`, `getSettings`, `onRecordingState` and `onSettingsUpdated` on the overlay page.',
    failure:
      '`src/overlay.ts` compiles against the full surface, so a future call such as `window.api.getHistory()` type-checks and then throws "window.api.getHistory is not a function" at runtime — in the overlay window only.',
    fix: 'Model the two API surfaces separately and type the overlay against the reduced one.',
    test: 'A type-level test is not possible here; assert the overlay module only uses the reduced API.',
  },
  {
    slug: 'friendly-error-auth-ordering',
    title: 'friendlyError matches "permission/denied" before "401/403"',
    severity: 'LOW',
    where: '`src/utils.ts:79-89`',
    context:
      'The table is first-match-wins, and the microphone-permission pattern comes before the authentication one, so a message containing both is classified as a microphone failure. The backend table (`backend/friendly-errors.cjs`) has the same ordering, so the two disagree in principle.',
    failure:
      'A raw upstream error such as "403 permission denied" renders as "Microphone blocked" instead of "Invalid API key", sending the user to the wrong place.',
    fix: 'Match the authentication pattern first, or make the patterns mutually exclusive.',
    test: 'A utils test for a message containing both a permission word and an auth code.',
  },
  {
    slug: 'transcription-result-applied-twice',
    title: 'The transcription result is applied twice in the main renderer',
    severity: 'LOW',
    where: '`main.cjs:380` and `src/recording.ts:65-70`',
    context:
      '`main.cjs` broadcasts `transcription-result` to the windows AND returns the same object to the renderer that invoked `stop-recording`. The renderer applies the returned value in `finishRecording` and also applies the broadcast in `handleTranscriptionResult`.',
    failure:
      '`showTranscript`, `showTranslation` and the paste-fallback toast all run twice per dictation. Currently harmless because they are idempotent, but it is one event handled twice.',
    fix: 'Deliver the result once — either by broadcast only, or by the invoke return only.',
    test: 'A recording test asserting the transcript is applied once.',
  },
  {
    slug: 'gemini-key-no-remove-affordance',
    title: 'The Gemini key has no remove affordance, and clearing the field does not delete the stored key',
    severity: 'LOW',
    where: '`src/settings-form.ts:509`, `backend/secrets.cjs:13-24`',
    context:
      'Deepgram and Speechmatics each have a "Remove key" button. The Gemini key has none, and clearing its input only blanks the field: `migratePlaintextKeys` skips an empty value, so the stored key is left in place.',
    failure:
      'A user who wants to revoke the Gemini key from the app has no way to do it, and may believe clearing the field removed it when it did not.',
    fix: 'Add a remove button for the Gemini key that calls `deleteSecret`, and make an explicitly cleared field delete the stored key.',
    test: 'A settings-form test that removes the Gemini key and asserts `deleteSecret` is called.',
  },

  // ── Second review round ────────────────────────────────────────────────────
  {
    slug: 'store-microphone-can-disagree-with-the-form',
    title: 'The shared store can hold a different microphone than the settings form shows',
    severity: 'LOW',
    where: '`src/settings-form.ts:110` (setOwnedSettings), `src/audio/recorder.ts:73`, `src/recording.ts:36`',
    context:
      '`runPersist` reads the microphone from the DOM, but the STORE keeps the value from the broadcast snapshot until the next save. `beginRecording` -> `startCapture(settings.microphone)` reads the store, not the form.',
    failure:
      'A user who switches microphone and hits record before the save round-trip completes records with the previous microphone.',
    fix:
      'Include the microphone in the set of values the settings form owns, or read the selection from the DOM at record time.',
    test: 'A settings-form test that changes the microphone, applies a broadcast, and asserts the store agrees.',
  },
  {
    slug: 'electron-harness-overrides-can-stub-the-module-under-test',
    title: 'The Electron harness override can replace the module it is meant to exercise',
    severity: 'LOW',
    where: '`test/helpers/electron-main-harness.cjs:29-31`',
    context:
      '`overrides` is consulted before the default stub switch and is keyed by module basename only, so an override named `settings.cjs` would replace `backend/settings.cjs` — the one module the harness deliberately does not stub ("the module under test").',
    failure:
      'A test that overrides `settings.cjs` by mistake silently stops exercising the real settings persistence, and the failure looks like a product bug.',
    fix: 'Refuse an override for `settings.cjs`, or require an explicit opt-in for it.',
    test: 'A harness test asserting an override for `settings.cjs` is rejected.',
  },
  {
    slug: 'electron-harness-stubs-missing-members',
    title: 'The Electron harness stubs are missing members main.cjs actually calls',
    severity: 'LOW',
    where: '`test/helpers/electron-main-harness.cjs:42-43`, `:57-58`',
    context:
      'The `secrets.cjs` stub has no `describeSecret`/`SECRET_NAMES`, so the `secret-state` handler throws a TypeError under the harness — the new `volatile` secret state cannot be exercised over IPC. The `engine-download.cjs` stub is `{}`, so `download-engine`/`activate-engine` would throw too.',
    failure:
      'The IPC surface for the secret status and the engine buttons cannot be tested; a test that reaches them fails with a stub error rather than an assertion.',
    fix: 'Complete the stub members main.cjs calls, or derive the stub surface from main.cjs.',
    test: 'A harness test that invokes every registered handler once and asserts none of them throws.',
  },
  {
    slug: 'dom-stub-getelementbyid-autocreates',
    title: 'The DOM stub creates unknown ids instead of returning null',
    severity: 'LOW',
    where: '`test/helpers/dom-stub.cjs` (getElementById)',
    context:
      'The real DOM returns `null` for an unknown id. The stub creates an element on demand, because `src/dom.ts` resolves ~70 ids at import time with a non-null assertion.',
    failure:
      'A typo\'d id in the renderer yields a phantom element in a test, so `getElementById(\'engine-download-row\')?.classList.toggle(...)` appears to work while being a no-op in the app.',
    fix:
      'Return null for ids outside a declared set, and let the harness declare the ids the renderer is allowed to resolve.',
    test: 'A stub test asserting an undeclared id resolves to null.',
  },
  {
    slug: 'dom-stub-select-value-and-option-tag',
    title: 'The DOM stub does not model <select> value semantics or lowercase option tags',
    severity: 'LOW',
    where: '`test/helpers/dom-stub.cjs` (select value, createElement)',
    context:
      '`select.value` is a plain string: it keeps a value no OPTION matches (a browser resets it to `\'\'`) and does not auto-select the first option. Separately, `document.createElement(\'option\')` yields `tagName === \'option\'` (lowercase), so it would not appear in `select.options` — and `src/audio/recorder.ts:65` uses exactly that form.',
    failure:
      'The "the stored value is not shown" case in `setSelectValue` is never exercised, and microphone enumeration would build an empty option list in a test while working in the app.',
    fix: 'Model `select.value` against the option list, and normalise `tagName` to upper case.',
    test: 'A stub test asserting `select.value` resets when no option matches.',
  },
  {
    slug: 'dom-stub-dispatch-does-not-bubble',
    title: 'The DOM stub does not bubble dispatched events',
    severity: 'LOW',
    where: '`test/helpers/dom-stub.cjs` (dispatch)',
    context:
      'The renderer uses delegated handlers on the toggle groups, so a test must dispatch on the group with an explicit `target`. Events never reach an ancestor listener.',
    failure:
      'A test proves the handler works but not that the buttons really live inside that group in `index.html`, nor that a real click bubbles.',
    fix: 'Bubble the event up the parent chain, as a browser does.',
    test: 'A stub test asserting a delegated parent listener receives the event.',
  },
];

fs.mkdirSync(OUT, { recursive: true });
for (const [index, issue] of ISSUES.entries()) {
  const number = String(index + 1).padStart(2, '0');
  const body = [
    `# ${number} — ${issue.title}`,
    '',
    'Status: ready-for-agent',
    'Type: task',
    'Blocked by: none',
    '',
    `Severity: ${issue.severity}`,
    '',
    '## Context',
    '',
    issue.where,
    '',
    issue.context,
    '',
    '## Failure scenario',
    '',
    issue.failure,
    '',
    '## Suggested fix',
    '',
    issue.fix,
    '',
    '## Test direction',
    '',
    issue.test,
    '',
    '## Comments',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT, `${number}-${issue.slug}.md`), body, 'utf8');
}

console.log(`Wrote ${ISSUES.length} issue files to ${OUT}`);
