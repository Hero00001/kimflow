# 29 — The DOM stub does not bubble dispatched events

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`test/helpers/dom-stub.cjs` (dispatch)

The renderer uses delegated handlers on the toggle groups, so a test must dispatch on the group with an explicit `target`. Events never reach an ancestor listener.

## Failure scenario

A test proves the handler works but not that the buttons really live inside that group in `index.html`, nor that a real click bubbles.

## Suggested fix

Bubble the event up the parent chain, as a browser does.

## Test direction

A stub test asserting a delegated parent listener receives the event.

## Comments
