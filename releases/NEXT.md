<!--
  Release notes for the NEXT release.

  Write them here, commit them, then run:
    Actions -> Release (Windows) -> Run workflow

  {{version}} is replaced with the number you type (e.g. 1.4.2). Use it in the
  heading so the notes can never disagree with the release.

  After the release is published, replace this file with notes for the next one.
  Older notes live on GitHub with each release and in this file's git history.
-->

# KimFlow {{version}}

This release fixes every finding from the full codebase audit, upgrades the
Electron runtime to a supported major (closing ~40 Chromium advisories,
including a contextIsolation bypass), and hardens how your API keys and
recordings are stored.

## Security

- **Electron 33 → 45.** The old runtime is end-of-life and carried ~40
  advisories, including a contextIsolation bypass and permission-origin
  confusion — the exact defenses KimFlow relies on.
- **Your API keys are safer in transit.** Gemini requests now authenticate
  with a request header instead of the URL query string.
- **A compromised renderer can no longer navigate or open windows:**
  navigation and window-open are denied on every window, and a window whose
  URL is not a KimFlow page loses IPC trust.
- **The whisper-binary existence oracle is closed**, and a renderer-supplied
  binary path can never reach program execution.
- All shipped dependencies audit clean. Axios/redirect advisories (SSRF,
  credential leakage) are gone.
- Content-Security-Policy on every window; all windows sandboxed.

## Dictation correctness

- A cancelled dictation now lands **nowhere**: no late paste into your
  document, no leftover history entry — even if you cancel mid-translation.
- Transcripts are no longer cleaned twice, which deleted valid words in
  Thorough mode.
- Digit-led sentences keep their casing ("23 apples", not "23 Apples");
  spoken decimals no longer merge into wrong numbers ("three point one,
  four" is 3.1 followed by 4).
- A failed Speechmatics job can no longer paste raw JSON into your document.

## Reliability

- **Your settings can no longer be wiped** by a locked or corrupt config
  file; saves are atomic with a backup, and a corrupt config recovers from
  its backup.
- **The floating capsule survives renderer crashes** (it now recreates
  itself) and pauses its animation loop when the machine sleeps or locks.
- A crashed app window reloads itself; the hotkey and the capsule keep
  working.
- Plugging in headphones no longer interrupts an active dictation; resuming
  after a mic change fails loudly instead of silently recording silence.
- Cancelling during transcription is finally possible (Escape or ✕).
- The floating widget's own death no longer leaks its timer and listeners.
- Stale temp recordings left by a crash are cleaned up at startup.

## Clarity

- Real errors now reach you: the tooltip always carries the actual reason,
  disk problems say "disk", bad API keys say "API key" — and genuine network
  failures are no longer silently swallowed as "cancelled".
- An AI-Polish failure tells you it fell back to the un-polished text.
- The Gemini key field has a **remove (✕)** button that actually deletes the
  stored key.
- A crash-recovery log is written to `%APPDATA%\KimFlow\logs\kimflow.log`.
- README corrected: where keys are stored, the default hotkey
  (`Ctrl+Shift+Space`), build outputs, and supported platforms.

## Known limitations

- The Language dropdowns still show English names in the Arabic/Chinese UI
  (tracked, needs native-speaker review).
- A custom accent color's hover shade is generated, not hand-tuned.
