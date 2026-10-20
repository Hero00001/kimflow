# 05 — The Gemini API key travels in the URL query string, and the log redaction is a no-op

Status: ready-for-agent
Type: task
Blocked by: none

Severity: LOW

## Context

`backend/gemini.cjs:59-64`, `:210-215`, `:260-265`, `:318-323`, `:273-278`

Every request passes the key as `params: { key }`, so it lands in the request URL. The console redaction is `endpoint.replace(/=([^&=]+)$/, '=[REDACTED]')`, but `endpoint` never contains the key — axios appends it from `params` — so the redaction protects nothing.

## Failure scenario

Any proxy, corporate gateway or server access log between the app and Google captures the full API key in the request URL, and the app's own attempt to keep it out of the logs does not work.

## Suggested fix

Send the key in the `x-goog-api-key` header instead of the query string, and redact the request URL as it is actually sent.

## Test direction

A gemini test asserting the key never appears in the request URL.

## Comments
