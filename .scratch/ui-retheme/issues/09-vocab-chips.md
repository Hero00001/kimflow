# 09 — Vocabulary chips UI

Status: ready-for-human
Blocked by: —

## Task

Replace the raw `#vocab-input` textarea presentation with per-term chips plus a count indicator using `MAX_TERMS` from `backend/vocabulary.cjs`. The underlying persisted setting shape must NOT change (still one string list) — this is a rendering/editing affordance only. Editing UX: add/remove chips, paste-to-add multi-line input retained as fallback.

## Acceptance

- Round-trip: chips render exactly what's stored; editing via chips produces the same persisted format.
- Count shows `n / MAX_TERMS`; over-limit is prevented with a clear note.
