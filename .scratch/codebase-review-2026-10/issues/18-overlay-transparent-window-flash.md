# 18 — The overlay is shown before its first paint

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`backend/overlay-window.cjs:19`, `main.cjs:152-161`

A transparent, frameless window is displayed immediately at construction; on Windows the compositor has not painted the page yet.

## Failure scenario

Every app start shows a brief opaque square at the top of the screen before the pill appears.

## Suggested fix

Create the window with `show: false` and show it on `ready-to-show`.

## Test direction

An overlay-window test asserting the window is not shown at construction.

## Comments
