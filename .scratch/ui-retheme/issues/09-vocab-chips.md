# 09 — Vocabulary chips UI

Status: resolved
Blocked by: —

## Task

Replace the raw `#vocab-input` textarea presentation with per-term chips plus a count indicator using `MAX_TERMS` from `backend/vocabulary.cjs`. The underlying persisted setting shape must NOT change (still one string list) — this is a rendering/editing affordance only. Editing UX: add/remove chips, paste-to-add multi-line input retained as fallback.

## Acceptance

- Round-trip: chips render exactly what's stored; editing via chips produces the same persisted format.
- Count shows `n / MAX_TERMS`; over-limit is prevented with a clear note.

## Comments

- DESIGN CHOICE (least code): the textarea stays the editing surface; chips are a live preview rendered above it from the textarea's parsed value. Multi-line paste, the existing `input`→debounced-persist and `change`→persist listeners, and the persisted format are all untouched — `runPersist()` still splits/trims/filters/slices the textarea value, so storage semantics are byte-identical (the only change: the magic `slice(0, 100)` now uses the named constant).
- MAX_TERMS is NOT exposed over IPC, so per the brief the renderer hardcodes `MAX_VOCAB_TERMS = 100` in settings-form.ts with a comment naming `backend/vocabulary.cjs` as the source of truth. No new IPC channel.
- Markup (`index.html`, inside the Output section's `#vocab-row`): `#vocab-chips` container above the textarea, `#vocab-count` notice, and `#vocab-limit-note` (hidden unless over limit). New bindings in `src/dom.ts`. CSS appended to style.css (`.vocab-chips`, `.vocab-chip`, `.vocab-chip-remove`, `#vocab-limit-note`), token-driven so it follows both themes.
- Editing: every chip carries a `✕` remove button (`.vocab-chip-remove`) that splices that line out of the textarea value, re-renders, and persists immediately. Each term renders as `.vocab-chip > .vocab-chip-term` (ellipsis-safe). Over-limit prevention: the count note (`settings.output.vocabLimit`) appears when the raw list exceeds 100, and both persist (`slice(0, MAX_VOCAB_TERMS)`) and backend `normalizeVocabulary` cap the stored list.
- Count re-renders on textarea input, on load (`loadSettingsIntoUi`), and on UI-language change (`applyLanguageToUi` → `refreshVocabUi()`), so the localized `n / 100 terms` string never goes stale.
- i18n (en/ar/zh): `settings.output.vocabCount` ('{count} / {max} terms'), `settings.output.vocabLimit`, `settings.output.removeTerm`. Placeholder parity holds ({count}/{max} in every locale); key-count tests bumped to 201; parity test green.
- Full suite 578/578 green; build green (dom.ts id gate covers the three new ids).

### Fix (2026-11-24)

- Chip ✕ spliced the textarea by the FILTERED term index, so with any blank line ('alpha\n\nbeta') removing 'beta' (filtered index 1) deleted the empty line and left 'beta' as an unremovable ghost chip. Fix: new pure helpers in `src/vocab.ts` — `parseVocabChips(lines)` builds chips carrying their RAW line index, `removeVocabLine(lines, rawIndex)` splices by it (out-of-range/stale clicks are a safe no-op copy). `renderVocabChips` now uses both; persisted format untouched. Coverage: `test/vocab-chips.test.cjs` (blank lines, trailing newline, duplicates, 200-char terms, stale-index no-ops).
