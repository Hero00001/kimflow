# 03 — Settings regroup: Input+Engine → Speech, Cleanup → Output

Status: ready-for-human
Blocked by: —

## Task

In `index.html`: merge the Input and Engine sections into one **Speech** section (hotkey rows first, then engine/model/download and the advanced sub-block); rename **Cleanup** to **Output** (new i18n keys) and move the vocabulary row into it (verify its current location first); add the chip-style section nav per the approved mockup. Every existing element id must survive unchanged (src/dom.ts resolves ids at load and throws on missing). Update section-related i18n keys in en/ar/zh.

## Acceptance

- All five old sections' rows exist in the new layout; zero settings removed or renamed as keys.
- Build passes; manual pass over every row still persists settings.
