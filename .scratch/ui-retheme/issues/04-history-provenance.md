# 04 — History provenance: engine + model per entry

Status: resolved
Blocked by: —

## Task

Persist `engine`, `model`, and `polishMode` on each history entry in `backend/history.cjs`; guard them in `normalizeHistoryData` with defaults so old entries render fine. Append the values to the existing `history-item-meta` line in `renderHistory()` (src/history.ts), e.g. `deepgram · nova-3 · light`.

## Acceptance

- New entries show provenance; old entries show a sensible fallback without errors.
- Existing history tests still pass.

## Comments

- `backend/history.cjs`: `addSession` now accepts `engine`/`model`/`polishMode` and persists each only when truthy — purely additive, old callers and old history files keep the old shape.
- `backend/recorder.cjs`: the `addSession` call site passes `settings.engine`, the model for the active engine (`deepgramModel` for deepgram, `whisperModel` for local, none for speechmatics — it has no selectable model), and `settings.polishMode`.
- `src/electron.d.ts`: `HistoryEntry` gained optional `engine`/`model`/`polishMode`.
- `src/history.ts`: `normalizeHistoryData` guards the three fields (non-string → undefined, so old entries never break); `renderHistory()` appends `engine · model · polishMode` to the existing `history-item-meta` line with the existing `•` separator, omitting absent parts.
- All history/clear/durability tests pass (full suite green).
