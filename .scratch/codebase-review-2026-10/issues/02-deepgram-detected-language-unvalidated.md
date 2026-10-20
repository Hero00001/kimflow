# 02 — Deepgram's detected language reaches the translation prompt unvalidated

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`backend/engines/deepgram.cjs:86-89`

`detectedLanguage` is taken from `alternative.languages?.[0]` and passed on as the translation source language (`backend/recorder.cjs`, `backend/gemini.cjs` `buildPrompt`). It is never checked against `backend/languages.cjs` `isKnownLanguage`, so a code the app does not know is interpolated into the prompt verbatim.

## Failure scenario

The Gemini prompt says "Translate the text below the language \"X\"" with an X the app never validated, which reads as a malformed instruction and can degrade the translation.

## Suggested fix

Validate the detected language with `isKnownLanguage` and fall back to `null` (meaning "its original language") when it is unknown.

## Test direction

A `deepgram` transcribe test whose response reports an unknown language code.

## Comments
