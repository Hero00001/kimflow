# 03 — The overlay window is trusted for every IPC channel, and nothing blocks navigation

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`main.cjs:181-187` (`assertTrustedSender`), `preload.cjs:54-70`

`assertTrustedSender` grants the overlay the same privileges as the main window for **all** channels. The preload limits the overlay to a smaller API only by checking the page URL, and there is no `will-navigate` or `setWindowOpenHandler` guard anywhere in the app.

## Failure scenario

If the overlay is ever navigated away from `overlay.html` — a redirect, a link with `target="_blank"`, a dev-server URL — the new document receives the full API from the preload and its `webContents.id` still passes `assertTrustedSender`, so it inherits main-window privileges including secret deletion and history access.

## Suggested fix

Restrict the mutating channels to the main window, and add `will-navigate` / `setWindowOpenHandler` guards to both windows.

## Test direction

A main-process test that calls a mutating handler with the overlay as the sender and expects it to be rejected.

## Comments
