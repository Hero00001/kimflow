# 07 — The Input Language and Translate To dropdowns are never localised

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`src/translation.ts:112-127`, `backend/languages.cjs:3-33`

`populateLanguages()` builds the options from the `label` the backend returns, and `backend/languages.cjs` hardcodes English names. The dropdowns carry no `data-i18n` and never pass through `t()`.

## Failure scenario

In the Arabic and Chinese interfaces — the two the app was just translated into — the language lists still read "Auto Detect", "English", "Chinese (Mandarin)".

## Suggested fix

Return language codes from the backend and map them to localised labels in the renderer. This needs 30 names per locale, so the Arabic and Chinese wording needs native review rather than a mechanical copy.

## Test direction

A locale-parity test covering the `languages.*` keys, once they exist.

## Comments
