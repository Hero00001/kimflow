# 09 — One rejected persist permanently stops settings persistence

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/settings-form.ts:217`

`persistChain = persistChain.then(runPersist)` has no rejection handler, so a single rejection turns the chain into a rejected promise and every later `persistChain.then(runPersist)` short-circuits.

## Failure scenario

Any change that makes `runPersist()` throw permanently freezes settings persistence for the rest of the session, with no visible error.

## Suggested fix

Add a `.catch` so one failure cannot poison the chain.

## Test direction

A settings-form test that rejects one save and checks the next one still reaches the backend.

## Comments
