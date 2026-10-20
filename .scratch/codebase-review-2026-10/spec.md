# KimFlow Codebase Review — Findings

Date: 2026-10-20 | Scope: whole repository (backend, renderer, packaging, tests)
Method: `graphify` knowledge graph for orientation → parallel per-area audits → every
candidate re-verified by reading the code and, where possible, executed.

Baseline before this work: `npm test` = 139 passing, `npx tsc --noEmit` = clean.

**Status: all P0 and P1 findings below are fixed.** The P2 findings are
recorded as tracker issues under `.scratch/codebase-review-2026-10/issues/`.
See `docs/superpowers/plans/2026-10-20-codebase-review-fixes.md` for the plan
and the fixes; every fix is pinned by a test that failed first.

Every finding below is labelled with how it was confirmed:

- **REPRODUCED** — a script in this repo produced the wrong behaviour/output.
- **CODE-TRACED** — read the full call path and the behaviour follows with no
  contradicting evidence.
- **NOT REPRODUCIBLE** — checked and found sound; recorded so it is not re-audited.

---

## 1. P0 — must fix

### 1.1 Gemini API key is destroyed and replaced by a fragment

- **Severity:** CRITICAL
- **Where:** `src/translation.ts:67` (`syncTranslationControls`),
  `src/settings-form.ts:202` (`applySettingsToUi`), `src/main.ts:73`
  (`onSettingsUpdated`), `backend/settings.cjs:148-150` (`save`)
- **Status:** REPRODUCED

`backend/settings.cjs:save()` blanks `geminiApiKey` before returning the saved
object, and `main.cjs:205-206` broadcasts that blanked object on every save.
`applySettingsToUi` → `syncTranslationControls` → `geminiKey.value = settings.geminiApiKey || ''`
writes the blank back into the input the user is typing into.

The Gemini key input has a 500 ms debounced save (`src/settings-form.ts:523`), so:

1. user types `AIzaSy` → debounce fires → keychain stores `AIzaSy` → broadcast
   blanks the input;
2. user keeps typing `ABC123` → the input now holds only `ABC123` → next save
   **overwrites the keychain entry with `ABC123`**.

Reproduced end-to-end against the real `migratePlaintextKeys`/`setSecret` logic:

```
user types "AIzaSyABC123" but pauses >500ms mid-typing:
  keychain now   : "AIzaSy"   field: ""
user continues typing "ABC123" (field was wiped, so this is ALL they see):
  keychain now   : "ABC123"
>>> CORRUPTED: true
```

Deepgram and Speechmatics are unaffected because nothing writes their inputs
back after the initial load — the asymmetry is what identifies the bug.

### 1.2 Six settings silently revert to their old value

- **Severity:** HIGH
- **Where:** `src/settings-form.ts:220-249` (`runPersist`), `src/store.ts:7-9`
  (`setSettings`), `src/settings-form.ts:193-208` (`applySettingsToUi`)
- **Status:** REPRODUCED

`engine`, `recordingMode`, `polishMode`, `translationEnabled`, `aiPolish` and
`whisperBinaryPath` have no DOM control, so the only carrier of their value is
an in-place mutation of the object returned by `getSettings()`. Every completed
save replaces that object wholesale (`setSettings(await saveSettings(...))`), and
every broadcast replaces it again (`applySettingsToUi` → `setSettings`). The
queued `runPersist` then reads the *replaced* object and re-saves the old value.

Reproduced:

```
after toggle, store.engine = deepgram
after broadcast, store.engine = local
persisted engine = local   <-- user selection LOST
```

The UI keeps showing the new selection (the toggle classes are never re-rendered
from settings), so the user is shown a state that was never stored.

### 1.3 `save-settings` aborts the entire save when the hotkey is unavailable

- **Severity:** HIGH
- **Where:** `main.cjs:199-216`
- **Status:** CODE-TRACED

```js
if (!isValidHotkey(candidate.hotkey) || !registerHotkeys(candidate.hotkey)) {
  throw new Error(`Unable to register capture hotkey: ${candidate.hotkey}`);
}
const saved = saveSettings(candidate);   // ← never reached
```

At startup the app already detects a hotkey that another application owns and
tells the user to change it (`main.cjs:502-517`). Until they do, **every**
settings save throws — including the one that saves their API keys. The thrown
message is not in the locale table, so the UI shows the generic
"Unable to save settings" with no explanation, and `errorDetails` discards it
(`src/utils.ts:58`, messages under 180 characters are dropped).

### 1.4 Number words are converted into the wrong number

- **Severity:** HIGH
- **Where:** `backend/format-numbers.cjs:37-90` (`parseRun`), `:104-160`
  (`formatNumberWords`)
- **Status:** REPRODUCED

Two independent defects, both writing a wrong number into the user's document:

**(a) A leading "and" is swallowed.** `parseRun` skips `and` with `continue`, so a
run that *starts* at "and" has its first word replaced by the number:

```
"I need milk and two eggs"        -> "I need milk 2 eggs"      ("and" deleted)
"five and six"                     -> "11"
"I want three apples and two oranges" -> "I want 3 apples 2 oranges"
```

**(b) Punctuation does not terminate a run.** `baseWord` strips trailing
punctuation, so `"one,"` compares equal to `"one"` and the run continues across
the comma — a list is summed into one number:

```
"one, two, three"        -> "6,"      (should be "1, 2, 3")
"one hundred, two hundred" -> "10200" (should be "100, 200")
"seven, eight, nine"      -> "24,"
```

A trailing `.`/`,` on a multi-word run is also dropped (`"twenty five." -> "25"`).

### 1.5 "Speech Cleanup: Off" still rewrites the transcript

- **Severity:** HIGH
- **Where:** `backend/cleanup.cjs:4-38`, `backend/format-numbers.cjs:104`
- **Status:** REPRODUCED

`polishText` honours `mode === 'off'` (`backend/polish.cjs:76`), but
`cleanupText` does not: it always converts number words, capitalises every
sentence and appends a trailing `.`.

```
cleanupText("i have twenty three apples", "off") -> "I have 23 apples."
```

The UI offers this as **Off** (`src/i18n/locales/en.ts:160-162`), so a user who
turns cleanup off still gets rewritten text pasted into their application.

### 1.6 Valid Electron hotkeys are rejected

- **Severity:** HIGH
- **Where:** `backend/hotkeys.cjs:25` (`MODIFIERS`), `:6-20` (`normalizeHotkey`)
- **Status:** REPRODUCED

Electron accepts `Command`, `Cmd`, `Control`, `Ctrl`, `CommandOrControl`,
`CmdOrCtrl`, `Alt`, `Option`, `AltGr`, `Shift`, `Super` and `Meta`. The whitelist
omits `Option`, `AltGr` and `Meta`:

```
isValidHotkey("Meta+Space")   -> false   (Electron accepts it)
isValidHotkey("Option+Space") -> false   (Electron accepts it)
```

Combined with 1.3, typing a perfectly valid accelerator locks the user out of
saving anything at all.

`normalizeHotkey` additionally maps `Cmd` → `Control` on non-darwin but leaves
`Command` → `Command`, and Electron documents that the `Command` modifier has no
effect on Windows/Linux. A hotkey recorded on Windows (`src/settings-form.ts:653`
emits `Command` for the meta key) therefore registers as a bare key.

### 1.7 Paste failures are never reported

- **Severity:** HIGH
- **Where:** `backend/paste.cjs:3-33`
- **Status:** REPRODUCED (control flow)

`pasteText` returns `{ ok: true }` synchronously while the actual paste runs in
an `execFile` callback whose error is only `console.error`-ed. `recorder.cjs:235`
therefore always computes `pasteOk === true`, and the whole paste-failure
fallback (`src/recording.ts:69`, `src/status.ts:124-126`,
`toast.pasteFallback`) is unreachable. Where `powershell.exe`/`osascript`/
`xdotool` is unavailable or blocked by policy, the user silently loses their
dictation with no indication that anything failed.

---

## 2. P1 — should fix

### 2.1 "actually" in the middle of a sentence deletes the sentence prefix

- **Severity:** MEDIUM-HIGH · **Where:** `backend/polish.cjs:33-45` · **Status:** REPRODUCED

```
"The report I actually needed was the blue one" -> "needed was the blue one"
"I think I actually like it"                     -> "like it"
```

The restart rule is intended (`test/polish.test.cjs:19-25` pins it) but it fires
on emphasis as well as on corrections. A subject pronoun immediately before the
marker is a reliable signal of emphasis.

### 2.2 Speechmatics forces English when the input language is Auto Detect

- **Severity:** MEDIUM-HIGH · **Where:** `backend/engines/speechmatics.cjs:33` · **Status:** CODE-TRACED + vendor docs

`language !== 'auto' ? language : 'en'` — the app's default input language is
`auto` (`backend/settings.cjs:37`), so every Speechmatics transcription is forced
to English and non-English speech comes back as English gibberish. Speechmatics
Batch supports `language: "auto"` (Language Identification). Deepgram handles the
same case with `multi` (`backend/engines/deepgram.cjs:21-23`).

### 2.3 A 10-minute recording is killed by a 120-second transcription timeout

- **Severity:** MEDIUM · **Where:** `backend/engines/local-whisper.cjs:122` ·
**Status:** CODE-TRACED

The recorder allows 10-minute dictations (`backend/recorder.cjs:27`), but
whisper.cpp is killed after 120 s. On timeout Node reports `code === null`, so
the crash-hint branch (`local-whisper.cjs:136`) is skipped and the user gets the
generic "Transcription failed" with no indication that it timed out.

### 2.4 A transient network error is cached as "model not found" for the session

- **Severity:** MEDIUM · **Where:** `backend/gemini.cjs:79-83`, `:111-118` ·
**Status:** CODE-TRACED

`inspectModel` caches `{found:false, error:'network'}` in `inspectedModels`
forever; `validateModel` turns any `!found` into "was not found for this API
key". A two-second network blip therefore poisons every later dictation with a
factually wrong diagnosis that cannot be cleared without restarting the app.

### 2.5 The translation cache ignores the model, provider and API key

- **Severity:** MEDIUM · **Where:** `backend/translation.service.cjs:7-9` ·
**Status:** CODE-TRACED

`cacheKey(sourceLanguage, targetLanguage, text)` omits the model, the provider
and the API key, all of which are passed to the provider. After switching model
or pasting a different key, the same phrase is served from the old cache.

### 2.6 "Clear history" keeps every transcript on disk

- **Severity:** MEDIUM · **Where:** `backend/history.cjs:97-99`, `:27-46` ·
**Status:** CODE-TRACED

`clear()` calls `save(emptyHistory())`, and `save()` copies the current file to
`history.json.bak` *before* overwriting it. The "cleared" transcripts therefore
remain in the backup, and `load()` falls back to that backup whenever the main
file is unreadable — so cleared history can reappear.

### 2.7 A secret that could not be persisted is deleted from the config anyway

- **Severity:** MEDIUM · **Where:** `backend/secrets.cjs:13-24`, `:58-83` ·
**Status:** CODE-TRACED

`setSecret` never throws — it catches everything and falls back to an in-memory
copy — so `migratePlaintextKeys`'s `try/catch` is dead code and `next[name] = ''`
always runs. Where `safeStorage` is unavailable (Linux without a secret store) or
the write fails, the plaintext is removed from `config.json` while the encrypted
file was never written: the key is gone after the next restart, silently.

`setSecret`'s `EPERM`/`EEXIST` fallback also unlinks the existing blob *before*
renaming the replacement into place, so a failure between the two destroys the
only copy.

### 2.8 The floating overlay is inert in the documented dev workflow

- **Severity:** MEDIUM-HIGH (dev only) · **Where:** `main.cjs:89-94`,
`src/overlay.html:109` · **Status:** CODE-TRACED

`getOverlayEntry()` always returns a `file://` URL. On a fresh clone `dist/` does
not exist, so it falls back to the source `src/overlay.html`, whose
`<script type="module" src="/src/overlay.ts">` resolves under `file://` to
`C:/src/overlay.ts`, which does not exist. The overlay renders its static HTML
with no JavaScript: every button is dead and the state text never changes. The
main window is unaffected because `getRendererEntry()` does use the dev server.

### 2.9 `npm run pack` / `npm run dist` ship an app with no renderer

- **Severity:** MEDIUM-HIGH (release only) · **Where:** `package.json:15-16`,
`:41-49` · **Status:** CODE-TRACED

`electron-builder` has no `beforeBuild` hook (confirmed in
`dist-electron/builder-effective-config.yaml`), and `dist/` is gitignored. A
packaging run on a clean checkout therefore produces an installer whose `app.asar`
contains no `dist/index.html`; `getRendererEntry()` takes the `file` branch and
`loadFile` fails — a blank main window and a dead overlay, shipped to users.

### 2.10 The 273 MB engine download blocks the main thread

- **Severity:** MEDIUM · **Where:** `backend/engine-download.cjs:86-90` ·
**Status:** CODE-TRACED

`sha256File` does `hash.update(fs.readFileSync(filePath))` — the whole NVIDIA
zip (272,982,859 bytes) is read into memory synchronously on the Electron main
thread, freezing the window, the overlay and the global hotkey for the duration.

---

## 3. P2 — recorded as tracker issues

Each of these is a real defect with a concrete user-visible consequence; each has
its own ticket under `.scratch/codebase-review-2026-10/issues/` (23 files,
numbered `01`–`23`).

| # | Finding | Where |
|---|---------|-------|
| 3.1 | Speechmatics poll deadline passes without the job being `done`; the transcript is fetched anyway and a JSON body is pasted as text | `backend/engines/speechmatics.cjs:74-118` |
| 3.2 | Deepgram's `detectedLanguage` is unvalidated and reaches the translation prompt verbatim | `backend/engines/deepgram.cjs:86-89` |
| 3.3 | The overlay's webContents is trusted for every IPC channel; no `will-navigate` / `setWindowOpenHandler` guard exists | `main.cjs:181-187`, `preload.cjs:54-70` |
| 3.4 | `check-whisper-binary` is an arbitrary-path existence oracle | `main.cjs:422-431` |
| 3.5 | The Gemini API key travels in the URL query string; the console redaction targets a string that never contains the key | `backend/gemini.cjs:59-64`, `:210-215`, `:273-278` |
| 3.6 | `renderStatic()` overwrites dynamically rendered text (`binary-path-display`, the three key-status rows) | `src/i18n/index.ts:104-121`, `index.html:212,235,254,310` |
| 3.7 | Input Language / Translate To dropdowns are never localised | `src/translation.ts:112-127`, `backend/languages.cjs:3-33` |
| 3.8 | `--accent-hover` is set to the accent colour, so every hover state is invisible | `src/theme.ts:12` vs `src/style.css:11` |
| 3.9 | A rejected `persistChain` permanently kills settings persistence | `src/settings-form.ts:217` |
| 3.10 | The saved microphone is silently overwritten by whatever is first in the device list | `src/settings-form.ts:223`, `src/audio/recorder.ts:70-76` |
| 3.11 | `pointerleave` stops a recording the button never started (push-to-talk) | `src/recording.ts:149-151` |
| 3.12 | Any device-list change pauses an active recording, not just a removed microphone | `src/audio/recorder.ts:209-223` |
| 3.13 | Resuming after a microphone change records silence, not the new device | `src/audio/recorder.ts:174-178` |
| 3.14 | A transcription cannot be cancelled from any UI although the backend supports it | `src/status.ts:69`, `src/overlay.ts:36` |
| 3.15 | Malformed history entries render `undefined` / `NaN sec` / `Invalid Date` | `src/history.ts:52,63` |
| 3.16 | A partial engine download leaks on Windows (the stream is still open when the file is unlinked) | `backend/engine-download.cjs:129-132` |
| 3.17 | Model and engine downloads share one `download-progress` channel with no discriminator | `backend/model-download.cjs:53-59`, `backend/engine-download.cjs:108-114` |
| 3.18 | The overlay is shown before its first paint (transparent-window flash) | `backend/overlay-window.cjs:19`, `main.cjs:152-161` |
| 3.19 | The hotkey restore path claims success even when the restore failed | `backend/hotkeys.cjs:51-67` |
| 3.20 | `electron.d.ts` models one full API for both windows; the overlay gets a subset | `src/electron.d.ts:79-119` vs `preload.cjs:54-60` |
| 3.21 | `friendlyError` matches "permission/denied" before "401/403", so a combined message is misclassified | `src/utils.ts:79-89` |
| 3.22 | The transcription result is applied twice in the main renderer | `main.cjs:380` + `src/recording.ts:65-70` |
| 3.23 | The Gemini key has no "remove" affordance, and clearing the field does not delete the stored key | `src/settings-form.ts:509`, `backend/secrets.cjs:13-24` |

---

## 4. Checked and found sound — do not re-audit

| Area | Note |
|------|------|
| Zip extraction | `safeEntryPath` rejects `../`, absolute and drive-letter entries and confines the resolved path to the destination. Covered by `test/engine-download.test.cjs:76-82`. |
| IPC sender validation | Every one of the 30 `ipcMain.handle` channels calls `assertTrustedSender`. |
| Model/flavor whitelisting | `modelSize` and `flavor` are validated against frozen allow-lists before use. |
| Secret values never reach the renderer | `get-settings` / `save-settings` both return blanked key fields. |
| Encryption | `safeStorage` is used; there is no homemade key stored next to the ciphertext. |
| `describeSecret` tri-state | `saved` / `missing` / `unreadable` are distinguished correctly and surfaced in the UI. |
| Gemini timeouts | Present on every request. |
| History read-modify-write | No `await` inside `load`/`save`/`addSession`/`updateSession`, so the sequences cannot interleave; writes are tmp+rename with a `.bak` fallback. |
| Translation cache size | Bounded to 30 entries by `pruneCache()`. |
| Window lifecycle | Every window reference inside an IPC handler is guarded; both windows are nulled on `closed`. |
| `encodeWav` | The WAV header is byte-correct: 44 + samples*2 bytes, RIFF size 36 + samples*2, mono/16-bit/16 kHz, and `OfflineAudioContext` renders exactly `frameCount` samples. |
| Vite `base: './'` | Correct for `file://`; the built `dist/index.html` uses relative asset URLs that resolve from the asar. |
| `tsconfig.json` | `module: ESNext` + `moduleResolution: bundler` is a valid pair; `npx tsc --noEmit` exits 0. |
| Locale parity | All 184 keys exist in `en`/`ar`/`zh`; every `{placeholder}` set matches across the three locales; no value equals its own key. |
| XSS | No `innerHTML`/`insertAdjacentHTML` anywhere in `src/`; all dynamic text goes through `textContent`. |
| DOM ids | Every id resolved by `src/dom.ts` exists in `index.html` (pinned by `test/i18n-markup.test.cjs:74-81`). |
| Event-listener leaks in settings | `wireSettingsControls()` runs once; `onStateChange` uses a `Set`. |
| `registerHotkeys` double registration | `unregisterHotkeys()` runs before each register, so there is no leaked shortcut. |
| Recorder state machine | Every exit path from `stopRecording` restores `STATE.READY` in its `finally`; a permanent `TRANSCRIBING` state is not reachable. |
| Start/stop during an in-flight start | `stopRequestedDuringStart` handles the double press correctly. |
| `recordingChunks` / meter RAF | Both are cleared/cancelled on abort; no leak. |
