# 08 — The accent hover colour is the accent colour, so no hover state is visible

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`src/theme.ts:12` vs `src/style.css:11`

`applyAccentColor()` sets `--accent-hover` to the accent colour itself, while the stylesheet default is a lighter shade (`#9d6ff7` against `#8b5cf6`).

## Failure scenario

Choosing any custom accent colour makes every `.btn-primary:hover` and `.ctrl-btn.primary:hover` render identically to its resting state, so the hover affordance disappears app-wide.

## Suggested fix

Derive a lighter hover shade from the accent colour, the way the stylesheet default does.

## Test direction

A theme test asserting `--accent-hover` differs from `--accent`.

## Comments
