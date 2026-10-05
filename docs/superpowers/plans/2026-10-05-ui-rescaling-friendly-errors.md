# UI Rescaling + Friendly Errors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings rows never push buttons off-screen and all failures show one friendly sentence with technical details hidden.

**Architecture:** CSS flex-chain fix with basename display; single friendly-error mapping shared by backend (`backend/friendly-errors.cjs`) and renderer (`src/utils.ts`); backend keeps raw in `error.details`.

**Tech Stack:** Electron + Vite + TypeScript renderer, Node CommonJS backend, `node:test` + `node:assert`, `tsc --noEmit`.

**Spec:** `docs/superpowers/specs/2026-10-05-ui-rescaling-friendly-errors-design.md`

## Global Constraints

- No new dependencies.
- No new error-center UI — reuse `#status-error` + `showError()`.
- Binary display is always `basename + ✓/✗` with `title=fullPath`.
- Abort is silent (no error shown).
- Each task ends with independently testable deliverable.

---

## File Structure

- Create: `backend/friendly-errors.cjs` — pure `friendlyMessageFor(err) -> string|null` + `getDetails(err)`, no imports.
- Modify: `backend/engines/local-whisper.cjs` — friendly top-line, raw moved to `error.details`.
- Modify: `backend/recorder.cjs` — empty transcript returns friendly-hint marker instead of silent `''`.
- Modify: `src/utils.ts` — add `friendlyError()` + `errorDetails()` mirroring backend table.
- Modify: `src/recording.ts`, `src/audio/recorder.ts`, `src/settings-form.ts` — `errorMessage` → `friendlyError`, set `title` tooltips.
- Modify: `src/style.css` — flex wrap/min-width chain + `#status-error` wrap.
- Modify: `index.html` — add `binary-row` class hook only.
- Test: `test/friendly-errors.test.cjs`, `test/local-whisper-errors.test.cjs`.

---

### Task 1: Backend friendly mapper

**Files:**
- Create: `backend/friendly-errors.cjs`
- Test: `test/friendly-errors.test.cjs`

**Interfaces:**
- Consumes: nothing (pure string matching on `err.name/message/code`).
- Produces: `friendlyMessageFor(err: unknown) -> string|null`, `getDetails(err: unknown) -> string|undefined` used by Task 2 and mirrored by Task 3.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
const { friendlyMessageFor } = require('../backend/friendly-errors.cjs');
test('maps mic NotAllowedError to friendly text', () => {
  const err = new Error('Permission denied');
  err.name = 'NotAllowedError';
  assert.equal(friendlyMessageFor(err), 'Microphone blocked — allow access in system settings, then try again.');
});
test('maps ENOENT binary to friendly text', () => {
  const err = new Error('spawn C:\\bin\\whisper-cli.exe ENOENT');
  err.code = 'ENOENT';
  assert.equal(friendlyMessageFor(err), 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.');
});
test('returns null for unknown', () => {
  assert.equal(friendlyMessageFor(new Error('weird xyz 123')), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/friendly-errors.test.cjs`
Expected: FAIL with "Cannot find module '../backend/friendly-errors.cjs'".

- [ ] **Step 3: Write minimal implementation**

```js
function msg(e){ if(e instanceof Error && e.message) return e.message; return String(e||''); }
function friendlyMessageFor(err){
  const m = msg(err); const name = err && err.name ? String(err.name) : ''; const code = err && err.code ? String(err.code) : '';
  if(name==='NotAllowedError'||name==='SecurityError'||/permission|not allowed|denied/i.test(m)) return 'Microphone blocked — allow access in system settings, then try again.';
  if(name==='NotFoundError'||name==='OverconstrainedError'||/requested device not found|no microphone|device not found/i.test(m)) return 'Microphone not found — check connection, then try again.';
  if(/NotReadableError|busy|in use|could not start/i.test(m)) return 'Microphone is busy — close other apps using it, then try again.';
  if(code==='ENOENT'||/ENOENT|binary not found|whisper binary not found/i.test(m)) return 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.';
  if(code==='EACCES'||/EACCES|permission denied.*whisper|not executable/i.test(m)) return 'Whisper binary is not executable — check permissions or re-select it in Settings.';
  if(/model not found|download a model/i.test(m)) return 'Whisper model not found — download it in Settings first.';
  if(/crashed|0xC000|access violation|stack.*overrun/i.test(m)) return 'Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.';
  if(/401|403|invalid api key|unauthorized/i.test(m)) return 'Invalid API key — check Settings and try again.';
  if(/api key not set|api key.*required/i.test(m)) return 'API key missing — add it in Settings first.';
  if(/ENOTFOUND|network|fetch failed|timeout|offline/i.test(m)) return 'Network error — check connection and retry.';
  if(/no speech|empty transcript|no transcript|silence/i.test(m)) return 'No speech detected — check mic level and try again.';
  if(name==='AbortError'||/aborted|abortion/i.test(m)) return null;
  if(!m || /whisper\.cpp failed|stderr:|exit code:/i.test(m)) return 'Transcription failed — see details and try again.';
  return null;
}
function getDetails(err){ if(err instanceof Error && typeof err.details==='string' && err.details) return err.details; const m=msg(err); return m.length>180?m:undefined; }
module.exports={friendlyMessageFor,getDetails};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/friendly-errors.test.cjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/friendly-errors.cjs test/friendly-errors.test.cjs
git commit -m "feat: backend friendly error mapper"
```

### Task 2: Local-whisper friendly top-line + empty-audio hint

**Files:**
- Modify: `backend/engines/local-whisper.cjs`
- Modify: `backend/recorder.cjs`
- Test: `test/local-whisper-errors.test.cjs`

**Interfaces:**
- Consumes: `friendlyMessageFor` from Task 1 (fallback when local logic has no better text).
- Produces: `Error.message` always friendly single-line; `Error.details` holds raw `stderr/stdout/exit code`; `stopRecording` empty case returns `{ text:'', empty:true }`.

- [ ] **Step 1: Write the failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
test('whisper missing-binary message is friendly single-line', async () => {
  const lw = require('../backend/engines/local-whisper.cjs');
  try { await lw.transcribe('small', 'nope.wav', 'auto', '/definitely/missing/whisper-cli', null, 'thorough', []); assert.fail('should throw'); }
  catch (e) { assert.ok(!/stderr|exit code/i.test(e.message), e.message); assert.ok(/not found|Select Binary/i.test(e.message), e.message); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/local-whisper-errors.test.cjs`
Expected: FAIL with raw `stderr/exit code` in message (current `parts.join('\n')` behavior).

- [ ] **Step 3: Write minimal implementation**

In `backend/engines/local-whisper.cjs` catch block, replace with:
```js
const { friendlyMessageFor } = require('../friendly-errors.cjs');
const raw = parts.join('\n');
const friendly = friendlyMessageFor(error) || 'Transcription failed — see details and try again.';
const out = new Error(friendly); out.details = raw.slice(0, 2000); out.code = error && error.code;
throw out;
```
In `backend/recorder.cjs`, replace `if (!cleaned) return '';` with:
```js
if (!cleaned) { const e = new Error('No speech detected — check mic level and try again.'); e.details = `empty transcript (engine=${settings.engine})`; throw e; }
```
And replace abort/cancel `return '';` paths to `return { text: '', aborted: true };` so renderer can stay silent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/local-whisper-errors.test.cjs test/friendly-errors.test.cjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/engines/local-whisper.cjs backend/recorder.cjs test/local-whisper-errors.test.cjs
git commit -m "feat: friendly whisper errors and empty-audio hint"
```

### Task 3: Renderer friendly errors + settings rescaling CSS

**Files:**
- Modify: `src/utils.ts`
- Modify: `src/recording.ts`
- Modify: `src/audio/recorder.ts`
- Modify: `src/settings-form.ts`
- Modify: `src/style.css`
- Modify: `index.html`

**Interfaces:**
- Consumes: Task 1 mapping table (mirror), Task 2 `Error.details` / `{aborted,empty}` shapes.
- Produces: visible UI — wrapped friendly errors, truncated binary name, clickable buttons at any width.

- [ ] **Step 1: Write the failing check (no test harness for TS — use tsc + grep gate)**

Run: `npx tsc --noEmit`
Expected: PASS baseline (record it). Then `grep -c "friendlyError" src/utils.ts` Expected: `0` (fails the gate — function missing).

- [ ] **Step 2: Implement `src/utils.ts` mirror**

```ts
export function errorDetails(error: unknown): string | undefined {
  if (error instanceof Error && typeof (error as Error & { details?: unknown }).details === 'string') {
    const d = (error as Error & { details: string }).details; return d.length ? d : undefined;
  }
  const m = error instanceof Error ? error.message : String(error ?? '');
  return m.length > 180 ? m : undefined;
}
export function friendlyError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && (error as { aborted?: boolean }).aborted) return '';
  const m = error instanceof Error && error.message ? error.message : String(error ?? '');
  if (/^(Microphone|Whisper|Invalid API|API key|Network|No speech|Transcription failed)/.test(m)) return m.split('\n')[0];
  const table: Array<[RegExp, string]> = [
    [/permission|not allowed|denied/i, 'Microphone blocked — allow access in system settings, then try again.'],
    [/device not found|no microphone|overconstrained/i, 'Microphone not found — check connection, then try again.'],
    [/ENOENT|binary not found/i, 'Whisper binary not found — use Select Binary in Settings to locate whisper-cli.'],
    [/model not found/i, 'Whisper model not found — download it in Settings first.'],
    [/crashed|0xC000/i, 'Whisper binary crashed — try a CPU-only build or reinstall VC++ Redistributable.'],
    [/401|403|invalid api key/i, 'Invalid API key — check Settings and try again.'],
    [/ENOTFOUND|fetch failed|timeout/i, 'Network error — check connection and retry.'],
    [/empty transcript|no speech|no transcript/i, 'No speech detected — check mic level and try again.'],
  ];
  for (const [re, text] of table) if (re.test(m)) return text;
  if (/abort/i.test(m)) return '';
  return fallback;
}
```

Replace all `errorMessage(` calls in `src/recording.ts`, `src/audio/recorder.ts`, `src/settings-form.ts` with `friendlyError(`, and after each `showError(friendly)` add `statusError.title = errorDetails(error) ?? ''` (import `statusError` from `./dom` where needed).

In `src/settings-form.ts` unify 3 spots:
```ts
function showBinaryName(fullPath: string, ok?: boolean) {
  const name = fullPath.split(/[/\\]/).pop() || fullPath;
  binaryPathDisplay.textContent = ok === undefined ? name : `${name} ${ok ? '✓' : '✗'}`;
  binaryPathDisplay.title = fullPath;
}
```

- [ ] **Step 3: Implement `src/style.css` rescaling**

```css
.s-row { flex-wrap: wrap; }
.s-row > * { min-width: 0; }
.model-row, .api-key-row, .model-field, .hotkey-editor, .api-key-footer { flex: 1 1 auto; min-width: 0; }
.binary-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn-primary, .btn-secondary { flex-shrink: 0; }
#status-error { white-space: normal; word-break: break-word; min-width: 0; flex-basis: 100%; }
@media (max-width: 560px) { .s-row.binary-row { flex-direction: column; align-items: stretch; } }
```
In `index.html` add `binary-row` to the Select Binary `s-row`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `node --test test/*.test.cjs`
Expected: PASS.
Manual: 120+ char Windows path → shows `whisper-cli.exe`, tooltip has full path, Browse/Recheck clickable narrow + wide.

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts src/recording.ts src/audio/recorder.ts src/settings-form.ts src/style.css index.html
git commit -m "feat: friendly renderer errors and settings rescaling"
```

## Self-Review

- Spec coverage: rescaling (Task 3 CSS + basename), mapper (Task 1), backend top-line + silence hint (Task 2), display wrap + tooltip (Task 3). Covered.
- Placeholder scan: no TBD/TODO; all steps have exact code + exact run commands.
- Type consistency: `friendlyMessageFor(err)->string|null`, `getDetails->string|undefined`, TS `friendlyError->string`, `errorDetails->string|undefined`, `Error.details:string`, `{aborted:true}`, `{text,empty:true}` shapes match across tasks.
