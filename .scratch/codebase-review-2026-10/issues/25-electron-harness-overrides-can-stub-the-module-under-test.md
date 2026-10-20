# 25 — The Electron harness override can replace the module it is meant to exercise

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`test/helpers/electron-main-harness.cjs:29-31`

`overrides` is consulted before the default stub switch and is keyed by module basename only, so an override named `settings.cjs` would replace `backend/settings.cjs` — the one module the harness deliberately does not stub ("the module under test").

## Failure scenario

A test that overrides `settings.cjs` by mistake silently stops exercising the real settings persistence, and the failure looks like a product bug.

## Suggested fix

Refuse an override for `settings.cjs`, or require an explicit opt-in for it.

## Test direction

A harness test asserting an override for `settings.cjs` is rejected.

## Comments
