# 17 — Model and engine downloads share one progress channel with no discriminator

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`backend/model-download.cjs:53-59`, `backend/engine-download.cjs:108-114`

Both emit `download-progress` with an identical `{downloaded,total,percent}` payload, and `main.cjs` has no mutual exclusion between the `download-model` and `download-engine` handlers.

## Failure scenario

Starting both at once shows the percentage of one item under the other's label.

## Suggested fix

Add a discriminator to the payload (a kind or id), and have the renderer route on it.

## Test direction

A settings-form test that interleaves two progress events.

## Comments
