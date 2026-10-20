# 27 — The DOM stub creates unknown ids instead of returning null

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`test/helpers/dom-stub.cjs` (getElementById)

The real DOM returns `null` for an unknown id. The stub creates an element on demand, because `src/dom.ts` resolves ~70 ids at import time with a non-null assertion.

## Failure scenario

A typo'd id in the renderer yields a phantom element in a test, so `getElementById('engine-download-row')?.classList.toggle(...)` appears to work while being a no-op in the app.

## Suggested fix

Return null for ids outside a declared set, and let the harness declare the ids the renderer is allowed to resolve.

## Test direction

A stub test asserting an undeclared id resolves to null.

## Comments
