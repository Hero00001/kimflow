# 28 — The DOM stub does not model <select> value semantics or lowercase option tags

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`test/helpers/dom-stub.cjs` (select value, createElement)

`select.value` is a plain string: it keeps a value no OPTION matches (a browser resets it to `''`) and does not auto-select the first option. Separately, `document.createElement('option')` yields `tagName === 'option'` (lowercase), so it would not appear in `select.options` — and `src/audio/recorder.ts:65` uses exactly that form.

## Failure scenario

The "the stored value is not shown" case in `setSelectValue` is never exercised, and microphone enumeration would build an empty option list in a test while working in the app.

## Suggested fix

Model `select.value` against the option list, and normalise `tagName` to upper case.

## Test direction

A stub test asserting `select.value` resets when no option matches.

## Comments
