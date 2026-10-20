# 15 — Malformed history entries render as "undefined", "NaN sec" and "Invalid Date"

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/history.ts:52`, `:63`, `:10-18`, `:20-27`

The search filter tolerates malformed entries (`session?.title || ''`), but the render loop dereferences `entry.title`, `entry.createdAt` and `entry.durationMs` unguarded. `formatDuration(undefined)` is `Math.max(1, NaN)` -> `NaN`, and `formatRelativeTime(undefined)` is `new Date(undefined)`.

## Failure scenario

One corrupt or older-format entry renders a history row titled "undefined" with "Invalid Date • NaN sec".

## Suggested fix

Skip entries without a usable title, and guard the duration and date formatting.

## Test direction

A history test that renders a malformed entry.

## Comments
