# 06 — renderStatic() overwrites values that are set at runtime

Status: ready-for-agent
Type: task
Blocked by: none

Severity: MEDIUM

## Context

`src/i18n/index.ts:104-121`, `index.html:212`, `:235`, `:254`, `:310`

`renderStatic()` stamps `t(key)` onto every element carrying `data-i18n`. Four of those elements also carry their text at runtime: `#binary-path-display` and the three `#*-key-status` rows.

## Failure scenario

Switching the UI language resets the binary row to "Not selected" and the key rows to "No key saved", discarding the live values. The settings form repairs them asynchronously, so the wrong values stand whenever that repair does not run.

## Suggested fix

Give the runtime-owned elements their own marker so `renderStatic` skips them, and let the settings form own their text entirely.

## Test direction

A `renderStatic` test asserting a runtime-owned element keeps its text.

## Comments
