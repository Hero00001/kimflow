<!--
  Release notes for the NEXT release.

  Write them here, commit them, then run:
    Actions -> Release (Windows) -> Run workflow

  {{version}} is replaced with the number you type (e.g. 1.4.2). Use it in the
  heading so the notes can never disagree with the release.

  After the release is published, replace this file with notes for the next one.
  Older notes live on GitHub with each release and in this file's git history.
-->

## KimFlow {{version}} — settings that stay put, and a key that stops corrupting itself

This release is mostly about things that went wrong quietly: settings that reverted after you saved them, an API key that could be damaged in the OS keychain, and a capture hotkey that could leave the whole app unconfigurable. All fixed — and every fix is covered by a test that fails without it.

### What actually changed

**Your Gemini key is safe.** KimFlow saves keys as you type, after a short delay. If the app was closed mid-save, that delayed write could land on top of the key you had just entered and damage it in the OS keychain. The key you type is now the key that gets stored, and a failed keychain write is reported instead of being shown as "Saved ✓".

**Six settings stop reverting.** Engine, recording mode, polish mode, translation, AI polish and the custom Whisper binary used to snap back to their previous value after a save — sometimes seconds later, with no warning. The Settings screen now owns those values, so a delayed save response can no longer overwrite what you just chose.

**A hotkey owned by another app no longer locks up Settings.** If another program already owned your capture shortcut, saving anything failed — including your API key. The shortcut is now reported on its own, the rest of your settings still save, and KimFlow keeps a shortcut that actually works.

**"Recheck" checks the engine you are using.** After switching to a different Whisper engine, Recheck could validate the previous binary and report a false failure next to the engine that was working.

**Numbers read correctly again.** `"one hundred, two hundred"` used to come out as `10200` — commas between numbers are now respected. "and" is no longer swallowed when it belongs to the sentence rather than to the number.

**A brief Gemini outage no longer disables translation.** A 503 or a rate-limit reply used to be remembered as "that model does not exist", silently turning translation off for the rest of the session.

### Under the hood

- The renderer had no tests at all, which is how the key-corruption bug shipped. It now has a DOM test harness and its own suite: 139 → 208 tests.
- Every new test was run against the old code to confirm it fails without the fix. A test that passes either way is not protecting anything.
- 29 further findings from the same review are filed as tracker issues rather than fixed here.
