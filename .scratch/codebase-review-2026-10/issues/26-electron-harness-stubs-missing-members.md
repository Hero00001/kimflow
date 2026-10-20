# 26 — The Electron harness stubs are missing members main.cjs actually calls

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`test/helpers/electron-main-harness.cjs:42-43`, `:57-58`

The `secrets.cjs` stub has no `describeSecret`/`SECRET_NAMES`, so the `secret-state` handler throws a TypeError under the harness — the new `volatile` secret state cannot be exercised over IPC. The `engine-download.cjs` stub is `{}`, so `download-engine`/`activate-engine` would throw too.

## Failure scenario

The IPC surface for the secret status and the engine buttons cannot be tested; a test that reaches them fails with a stub error rather than an assertion.

## Suggested fix

Complete the stub members main.cjs calls, or derive the stub surface from main.cjs.

## Test direction

A harness test that invokes every registered handler once and asserts none of them throws.

## Comments
