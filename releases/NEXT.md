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

SenseVoice joins as a second local engine, the app gets a light theme, and the
settings page is reorganized. A code review of all of that turned up six more
bugs, fixed here too.

## New: SenseVoice local engine

- **Chinese, Japanese, Korean and Cantonese dictation can now run fully
  offline** through SenseVoice-Small. Pick it in Settings → Speech under Local
  engine, next to Whisper.
- One click downloads the runtime and the model (about 185 MB total) behind a
  single progress bar. The runtime needs no VC++ Redistributable.
- English, Arabic and every other language keep using Whisper. If SenseVoice
  is missing or half-installed, dictation falls back to Whisper and the UI
  tells you which one is active.
- History entries now record what produced them: engine, model and polish
  mode.

## Appearance

- **Light theme.** A black-and-white day mode sits next to the dark one.
  Settings → Appearance → Theme offers System, Light and Dark. Dark stays the
  default so nothing changes until you ask; System follows Windows live.
- The accent color picker still works. Leave it alone and each theme uses its
  own designed accent (black in light mode, purple in dark).
- The floating overlay stays dark in both themes, since it sits on top of
  whatever app you are typing into.

## Settings, reorganized

- Input and Engine are now one Speech section. Text cleanup is called Output.
  A row of section chips at the top opens, collapses and scrolls to each
  section.
- Every existing setting survived the move. Nothing was removed.

## History and vocabulary

- Clearing history now asks twice. A stray click no longer wipes it.
- Every history entry has a copy button.
- The vocabulary field shows chips with a count instead of a bare textarea.
  The stored format is unchanged.

## Fixes

- Changing any setting no longer silently flips the app to your Windows
  theme. The Theme dropdown was not initialized on load, so the next save
  rewrote the theme behind your back.
- SenseVoice problems used to show up as "Whisper model not found" or
  "Network error". They now say what actually happened.
- Removing a vocabulary chip with blank lines in the list removed the wrong
  line and left a chip that could not be removed.
- A failed re-download can no longer destroy a working SenseVoice install,
  and two downloads of the same model can no longer run at once.
- The UI could show SenseVoice as not ready while it was actually in use.
- Arabic and Chinese UI text ships with the app now (IBM Plex Sans Arabic,
  Noto Sans SC), so it renders the same on every machine instead of depending
  on your installed Windows fonts.
- Labels across the app moved to sentence case, and the i18n tests now fail
  when a translation goes missing or empty in any language.

## Known limitations

- SenseVoice does not support the vocabulary list; your words still apply to
  Whisper and Deepgram.
- The SenseVoice setup downloads about 185 MB on first use.
- No auto-update and no code signing, unchanged from earlier releases.
