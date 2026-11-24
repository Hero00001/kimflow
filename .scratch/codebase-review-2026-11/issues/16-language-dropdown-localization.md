# 16 — Localize the language dropdowns (needs NATIVE ar/zh review)

Status: ready-for-human (blocked on a native ar/zh reviewer)
Type: task
Batch: follow-up of B9
Depends on: 10
Severity: MEDIUM (HIGH for ar/zh users)

## Defect (#07)

The Input Language and Translate To dropdowns render 30 language names
hardcoded in English: `translation.ts` builds options from
`backend/languages.cjs` labels via `new Option(option.label, …)` with no
`t()` call. An Arabic or Chinese user sees English names in an otherwise
translated UI.

## Why deferred from B9

The ticket itself requires native ar/zh review. Translating 60 strings
(30 languages × 2 lists) without a native reviewer ships unreviewed UI text —
rejected deliberately per the user's "be careful" rule.

## Fix direction (mechanism is ready)

1. Add `name_ar` / `name_zh` per entry in `backend/languages.cjs` (or map
   codes through locale keys — prefer the data-file approach: language names
   are not UI-chrome keys and the 189-key parity test stays untouched).
2. `translation.ts` picks `name_${lang}` when present, falling back to the
   English label.
3. Native review pass over both lists before release.
4. Test: dropdown options carry the active language's names; parity test
   unchanged.

## Acceptance

With UI language = العربية or 中文, both dropdowns render native names;
English unchanged; parity + placeholder tests green.
