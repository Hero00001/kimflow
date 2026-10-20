# 21 — friendlyError matches "permission/denied" before "401/403"

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/utils.ts:79-89`

The table is first-match-wins, and the microphone-permission pattern comes before the authentication one, so a message containing both is classified as a microphone failure. The backend table (`backend/friendly-errors.cjs`) has the same ordering, so the two disagree in principle.

## Failure scenario

A raw upstream error such as "403 permission denied" renders as "Microphone blocked" instead of "Invalid API key", sending the user to the wrong place.

## Suggested fix

Match the authentication pattern first, or make the patterns mutually exclusive.

## Test direction

A utils test for a message containing both a permission word and an auth code.

## Comments
